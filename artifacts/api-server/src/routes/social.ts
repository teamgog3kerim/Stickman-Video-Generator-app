import { Router, type IRouter } from "express";
import { ListSocialProvidersResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/social/providers", (_req, res): void => {
  res.json(
    ListSocialProvidersResponse.parse([
      {
        provider: "youtube",
        label: "YouTube",
        configured: false,
        connected: false,
        accountName: null,
        note: "YouTube developer app setup is required before accounts can connect.",
      },
      {
        provider: "instagram",
        label: "Instagram Reels",
        configured: false,
        connected: false,
        accountName: null,
        note: "A Meta developer app with Instagram publishing permissions is required.",
      },
      {
        provider: "tiktok",
        label: "TikTok",
        configured: false,
        connected: false,
        accountName: null,
        note: "TikTok developer app setup and publishing approval are required.",
      },
    ]),
  );
});

export default router;
