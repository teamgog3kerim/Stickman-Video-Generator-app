import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ListSocialProvidersResponse,
  UpdateSocialProviderProfileBody,
  UpdateSocialProviderProfileParams,
  UpdateSocialProviderProfileResponse,
} from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuth);

type Provider = "youtube" | "instagram" | "tiktok";
const providerInfo: Record<Provider, { label: string; note: string; domains: string[] }> = {
  youtube: {
    label: "YouTube",
    note: "YouTube developer app setup is required before accounts can connect.",
    domains: ["youtube.com", "youtu.be"],
  },
  instagram: {
    label: "Instagram Reels",
    note: "A Meta developer app with Instagram publishing permissions is required.",
    domains: ["instagram.com"],
  },
  tiktok: {
    label: "TikTok",
    note: "TikTok developer app setup and publishing approval are required.",
    domains: ["tiktok.com"],
  },
};
function isAllowedProfileUrl(provider: Provider, value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      providerInfo[provider].domains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

function providerStatus(provider: Provider, profileUrl: string | null) {
  const info = providerInfo[provider];
  return {
    provider,
    label: info.label,
    configured: false,
    connected: false,
    accountName: null,
    profileUrl,
    note: info.note,
  };
}

router.get("/social/providers", async (req, res): Promise<void> => {
  const [user] = await db
    .select({
      youtubeProfileUrl: usersTable.youtubeProfileUrl,
      instagramProfileUrl: usersTable.instagramProfileUrl,
      tiktokProfileUrl: usersTable.tiktokProfileUrl,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.authUser!.id))
    .limit(1);

  res.json(
    ListSocialProvidersResponse.parse([
      providerStatus("youtube", user?.youtubeProfileUrl ?? null),
      providerStatus("instagram", user?.instagramProfileUrl ?? null),
      providerStatus("tiktok", user?.tiktokProfileUrl ?? null),
    ]),
  );
});

router.patch("/social/providers/:provider/profile", async (req, res): Promise<void> => {
  const params = UpdateSocialProviderProfileParams.safeParse(req.params);
  const body = UpdateSocialProviderProfileBody.safeParse(req.body);
  if (!params.success || !body.success || !req.authUser) {
    res.status(400).json({ error: "Enter a valid YouTube, Instagram, or TikTok profile URL." });
    return;
  }

  const { provider } = params.data;
  const { profileUrl } = body.data;
  if (profileUrl && !isAllowedProfileUrl(provider, profileUrl)) {
    res.status(400).json({
      error: `Use a secure ${providerInfo[provider].label} profile URL.`,
    });
    return;
  }

  const changes =
    provider === "youtube"
      ? { youtubeProfileUrl: profileUrl }
      : provider === "instagram"
        ? { instagramProfileUrl: profileUrl }
        : { tiktokProfileUrl: profileUrl };
  const [updated] = await db
    .update(usersTable)
    .set(changes)
    .where(eq(usersTable.id, req.authUser.id))
    .returning({ id: usersTable.id });
  if (!updated) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  res.json(UpdateSocialProviderProfileResponse.parse(providerStatus(provider, profileUrl)));
});

export default router;
