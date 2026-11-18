const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function getPrivateObjectLocation(relativePath: string) {
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) {
    throw new Error("Private App Storage is not configured.");
  }

  const parts = directory.split("/").filter(Boolean);
  const bucketName = parts[0];
  if (!bucketName) {
    throw new Error("Private App Storage directory is invalid.");
  }

  const prefix = parts.slice(1).join("/");
  const objectName = [prefix, relativePath].filter(Boolean).join("/");
  return { bucketName, objectName };
}

async function signObjectUrl(bucketName: string, objectName: string, method: "GET" | "PUT" | "DELETE") {
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`App Storage could not sign a ${method} request (${response.status}).`);
  }

  const result = (await response.json()) as { signed_url?: unknown };
  if (typeof result.signed_url !== "string") {
    throw new Error("App Storage returned an invalid signed URL.");
  }
  return result.signed_url;
}

export function renderedVideoObjectPath(userId: string, videoId: string) {
  return `/objects/renders/${userId}/${videoId}.mp4`;
}

function getObjectLocation(objectPath: string) {
  if (!objectPath.startsWith("/objects/") || objectPath.includes("..")) {
    throw new Error("Saved video object path is invalid.");
  }
  return getPrivateObjectLocation(objectPath.slice("/objects/".length));
}

export async function saveRenderedVideo(
  buffer: Buffer,
  objectPath: string,
  fileName: string,
): Promise<void> {
  const { bucketName, objectName } = getObjectLocation(objectPath);
  const signedUrl = await signObjectUrl(bucketName, objectName, "PUT");
  const response = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
    body: buffer,
  });
  if (!response.ok) {
    throw new Error(`MP4 could not be saved in App Storage (${response.status}).`);
  }
}

export async function removeRenderedVideoObject(objectPath: string): Promise<void> {
  const { bucketName, objectName } = getObjectLocation(objectPath);
  const signedUrl = await signObjectUrl(bucketName, objectName, "DELETE");
  const response = await fetch(signedUrl, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Saved MP4 cleanup failed (${response.status}).`);
  }
}

export async function openRenderedVideoObject(objectPath: string, range?: string): Promise<Response> {
  const { bucketName, objectName } = getObjectLocation(objectPath);
  const signedUrl = await signObjectUrl(bucketName, objectName, "GET");
  return fetch(signedUrl, { headers: range ? { Range: range } : undefined });
}
