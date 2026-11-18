import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { RenderVideoBody } from "@workspace/api-zod";
import { db, projectsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { renderStoryboardVideo } from "../lib/videoRenderer";

const router: IRouter = Router();
router.use(requireAuth);

router.post("/videos/render", async (req, res): Promise<void> => {
  const parsed = RenderVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a project to render." });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.id, parsed.data.projectId),
        eq(projectsTable.userId, req.authUser!.id),
      ),
    )
    .limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  if (!project.approvedAt) {
    res.status(400).json({ error: "Approve the brief before rendering the video." });
    return;
  }

  const narrationTexts = project.scenes.map((scene) => scene.narration.trim());
  const emptySceneIndex = narrationTexts.findIndex((text) => !text);
  if (project.voiceover && emptySceneIndex !== -1) {
    res.status(400).json({
      error: `Add narration to scene ${emptySceneIndex + 1} so the voiceover covers the full video.`,
    });
    return;
  }
  const shortScene = project.voiceover
    ? project.scenes.find((scene) => {
        const words = scene.narration.trim().split(/\s+/).length;
        return words < Math.ceil(scene.seconds * 1.45);
      })
    : undefined;
  if (shortScene) {
    const minimumWords = Math.ceil(shortScene.seconds * 1.45);
    res.status(400).json({
      error: `Add more narration to “${shortScene.title}”. Its ${shortScene.seconds}-second scene needs about ${minimumWords} words or more.`,
    });
    return;
  }
  const longScene = project.voiceover
    ? project.scenes.find((scene) => scene.narration.trim().split(/\s+/).length > Math.ceil(scene.seconds * 3.2))
    : undefined;
  if (longScene) {
    res.status(400).json({
      error: `Shorten the narration for “${longScene.title}” or increase its scene duration.`,
    });
    return;
  }
  const narration = narrationTexts.join("\n\n");
  if (project.voiceover && narration.length > 16000) {
    res.status(400).json({
      error: "Voiceover is limited to 16,000 characters per render. Shorten the script or turn voiceover off.",
    });
    return;
  }

  try {
    const rendered = await renderStoryboardVideo({
      title: project.title,
      aspectRatio: project.aspectRatio,
      styleId: project.styleId,
      voiceover: project.voiceover,
      subtitles: project.subtitles,
      scenes: project.scenes,
    });
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${rendered.filename}"`);
    res.setHeader("Content-Length", rendered.buffer.length);
    res.send(rendered.buffer);
  } catch (error) {
    req.log.error(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      },
      "Video render failed",
    );
    res.status(500).json({ error: "Video rendering failed. Check the brief and try again." });
  }
});

export default router;
