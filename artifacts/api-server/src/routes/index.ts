import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import projectsRouter from "./projects";
import adminRouter from "./admin";
import storyboardsRouter from "./storyboards";
import socialRouter from "./social";
import videosRouter from "./videos";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(projectsRouter);
router.use(storyboardsRouter);
router.use(socialRouter);
router.use(videosRouter);
router.use(adminRouter);

export default router;
