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

  const narrationLength = project.scenes.reduce(
    (total, scene) => total + scene.narration.length,
    0,
  );
  if (project.voiceover && narrationLength > 6000) {
    res.status(400).json({
      error: "Voiceover is limited to 6,000 characters per render. Shorten the narration or turn voiceover off.",
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
