import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  ApproveProjectParams,
  ApproveProjectResponse,
  CreateProjectBody,
  CreateProjectResponse,
  DeleteProjectParams,
  ListProjectsResponse,
  UpdateProjectBody,
  UpdateProjectParams,
  UpdateProjectResponse,
} from "@workspace/api-zod";
import { db, projectsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/projects", async (req, res): Promise<void> => {
  const projects = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.userId, req.authUser!.id))
    .orderBy(desc(projectsTable.updatedAt));
  res.json(ListProjectsResponse.parse(projects));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Project details are invalid." });
    return;
  }

  const [project] = await db
    .insert(projectsTable)
    .values({
      ...parsed.data,
      userId: req.authUser!.id,
    })
    .returning();
  res.status(201).json(CreateProjectResponse.parse(project));
});

router.put("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  const body = UpdateProjectBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Project details are invalid." });
    return;
  }

  const [project] = await db
    .update(projectsTable)
    .set({ ...body.data, approvedAt: null })
    .where(
      and(
        eq(projectsTable.id, params.data.id),
        eq(projectsTable.userId, req.authUser!.id),
      ),
    )
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.json(UpdateProjectResponse.parse(project));
});

router.post("/projects/:id/approve", async (req, res): Promise<void> => {
  const params = ApproveProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Project ID is invalid." });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.id, params.data.id),
        eq(projectsTable.userId, req.authUser!.id),
      ),
    )
    .limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const completeScenes = project.scenes.length >= 3 && project.scenes.every(
    (scene) => scene.title.trim() && scene.narration.trim() && scene.visualDirection.trim(),
  );
  if (!project.topic.trim() || !completeScenes) {
    res.status(400).json({
      error: "Add a topic and complete at least three scenes before approving this brief.",
    });
    return;
  }

  const [approved] = await db
    .update(projectsTable)
    .set({ approvedAt: new Date() })
    .where(
      and(
        eq(projectsTable.id, project.id),
        eq(projectsTable.userId, req.authUser!.id),
      ),
    )
    .returning();
  res.json(ApproveProjectResponse.parse(approved));
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Project ID is invalid." });
    return;
  }
  const [project] = await db
    .delete(projectsTable)
    .where(
      and(
        eq(projectsTable.id, params.data.id),
        eq(projectsTable.userId, req.authUser!.id),
      ),
    )
    .returning({ id: projectsTable.id });
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.sendStatus(204);
});

export default router;
