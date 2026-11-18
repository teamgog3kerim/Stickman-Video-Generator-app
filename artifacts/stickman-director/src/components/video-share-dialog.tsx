import { useEffect, useState } from "react";
import { Copy, Download, ExternalLink, Film, Instagram, Sparkles, Youtube } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGenerateVideoShareCopy } from "@workspace/api-client-react";
import type { DownloadedVideo, SocialSharePlatformCopy } from "@workspace/api-client-react";
import { translateActive } from "@/lib/i18n";
import "./video-share.css";

type Platform = SocialSharePlatformCopy["platform"];

const platforms: { id: Platform; label: string; uploadUrl: string; icon: typeof Youtube }[] = [
  { id: "youtube", label: "YouTube", uploadUrl: "https://studio.youtube.com/", icon: Youtube },
  { id: "instagram", label: "Instagram Reels", uploadUrl: "https://www.instagram.com/", icon: Instagram },
  { id: "tiktok", label: "TikTok", uploadUrl: "https://www.tiktok.com/upload", icon: Film },
];

function makeShareText(copy: SocialSharePlatformCopy, caption: string, hashtags: string[]) {
  return [
    copy.platform === "youtube" ? copy.title : "",
    caption.trim(),
    hashtags.join(" "),
  ].filter(Boolean).join("\n\n");
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

export function VideoShareDialog({
  video,
  onClose,
  notify,
}: {
  video: DownloadedVideo | null;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const generate = useGenerateVideoShareCopy();
  const t = translateActive;
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [generatedFor, setGeneratedFor] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);

  useEffect(() => {
    if (!video) {
      generate.reset();
      setGeneratedFor(null);
      return;
    }
    setPlatform("youtube");
    setCaption("");
    setHashtags([]);
    setGeneratedFor(null);
  }, [video?.id]);

  const copy = generatedFor === video?.id
    ? generate.data?.copies.find((item) => item.platform === platform)
    : undefined;

  useEffect(() => {
    if (copy) {
      setCaption(copy.caption);
      setHashtags(copy.hashtags);
    }
  }, [copy]);

  const copyShareText = async () => {
    if (!copy) return;
    try {
      await copyToClipboard(makeShareText(copy, caption, hashtags));
      notify(t("Caption and hashtags copied"));
    } catch {
      notify(t("Could not copy share text. Select and copy it manually."));
    }
  };

  const openPlatform = () => {
    const target = platforms.find((item) => item.id === platform)!;
    window.open(target.uploadUrl, "_blank", "noopener,noreferrer");
  };

  const generateCopy = () => {
    if (!video) return;
    generate.mutate({ id: video.id }, { onSuccess: () => setGeneratedFor(video.id) });
  };

  return (
    <Dialog open={Boolean(video)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {video && (
        <DialogContent className="director-dialog share-dialog" data-testid="dialog-video-share">
          <DialogHeader className="director-dialog-header share-dialog-header">
            <span className="mono share-kicker"><Sparkles size={12}/> {t("PREVIEW & GUIDED SHARING")}</span>
            <DialogTitle className="director-dialog-title">{video.title || t("Rendered video")}</DialogTitle>
            <DialogDescription className="director-dialog-copy">
              {t("Preview your MP4, choose a platform, and prepare its caption and hashtags.")}
            </DialogDescription>
          </DialogHeader>

          <div className="share-dialog-grid">
            <div className="share-preview-column">
              <video
                className={`share-video ${video.aspectRatio === "9:16" ? "vertical" : ""}`}
                controls
                playsInline
                preload="metadata"
                src={`/api/videos/downloads/${video.id}/preview`}
                aria-label={`${t("Preview of")} ${video.title}`}
                data-testid="video-saved-preview"
              />
              <div className="share-video-meta mono">
                <span>{video.aspectRatio} · {video.durationSeconds}s</span>
                <span>{new Date(video.createdAt).toLocaleDateString()}</span>
              </div>
              <a className="btn btn-outline share-download" href={`/api/videos/downloads/${video.id}/file`} data-testid="button-share-download">
                <Download size={14}/>{t("Download MP4")}
              </a>
            </div>

            <div className="share-copy-column">
              <span className="field-label">{t("Choose a platform")}</span>
              <div className="share-platforms" role="tablist" aria-label={t("Social platforms")}>
                {platforms.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={platform === item.id}
                      className={`share-platform ${platform === item.id ? "selected" : ""}`}
                      data-testid={`tab-share-${item.id}`}
                      onClick={() => setPlatform(item.id)}
                    >
                      <Icon size={14}/>{item.label}
                    </button>
                  );
                })}
              </div>

              {!copy && !generate.isPending && !generate.isError && (
                <div className="share-copy-intro" data-testid="panel-share-copy-intro">
                  <p>{t("Generate a caption and relevant hashtags for all three platforms. This uses Replit AI credits; suggestions are not live trend rankings.")}</p>
                  <button type="button" className="btn btn-primary" data-testid="button-generate-share-copy" onClick={generateCopy}><Sparkles size={14}/>{t("Generate captions & hashtags")}</button>
                </div>
              )}
              {generate.isPending && <div className="share-loading" role="status" data-testid="status-share-copy-loading"><i/><span>{t("Writing platform-specific share copy…")}</span></div>}
              {generate.isError && (
                <div className="share-copy-error" role="alert" data-testid="status-share-copy-error">
                  <p>{t("Could not generate captions and hashtags.")}</p>
                  <button type="button" className="text-link" data-testid="button-retry-share-copy" onClick={generateCopy}>{t("Try again")}</button>
                </div>
              )}

              {copy && (
                <>
                  {platform === "youtube" && <label className="share-field">{t("Video title")}<input value={copy.title} readOnly aria-label={t("Suggested YouTube title")}/></label>}
                  <label className="share-field">{t("Caption")}<textarea value={caption} maxLength={1600} onChange={(event) => setCaption(event.target.value)} data-testid="input-share-caption"/></label>
                  <div className="share-tags-field">
                    <div className="share-tags-heading"><span className="field-label">{t("Suggested hashtags")}</span><small>{t("Tap tags to include or exclude")}</small></div>
                    <div className="share-tags">
                      {copy.hashtags.map((tag) => (
                        <button
                          type="button"
                          key={tag}
                          className={`share-tag ${hashtags.includes(tag) ? "included" : ""}`}
                          aria-pressed={hashtags.includes(tag)}
                          onClick={() => setHashtags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                  <small className="share-note" data-testid="note-share-trends">{t("AI creates relevance-focused suggestions with Replit AI credits. They are not live trend rankings.")}</small>
                  <div className="share-actions">
                    <button type="button" className="btn btn-outline" data-testid="button-copy-share-text" onClick={copyShareText}><Copy size={14}/>{t("Copy share text")}</button>
                    <button type="button" className="btn btn-primary" data-testid="button-open-social-platform" onClick={openPlatform}><ExternalLink size={14}/>{t("Open")} {platforms.find((item) => item.id === platform)?.label}</button>
                  </div>
                  <p className="share-upload-note">{t("OAuth is not connected in this app. Upload the MP4 on the platform page after copying your text.")}</p>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
