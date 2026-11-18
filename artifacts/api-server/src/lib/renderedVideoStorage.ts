import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const S3_ENVIRONMENT_KEYS = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

let cachedS3Client: S3Client | undefined;

function isS3Configured(): boolean {
  return S3_ENVIRONMENT_KEYS.some((key) => Boolean(process.env[key]));
}

function getS3Client(): { client: S3Client; bucket: string } {
  const missing = S3_ENVIRONMENT_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Object storage is missing required settings: ${missing.join(", ")}.`);
  }

  if (!cachedS3Client) {
    cachedS3Client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
  }

  return { client: cachedS3Client, bucket: process.env.S3_BUCKET! };
}

export function assertRenderedVideoStorageConfigured(): void {
  if (isS3Configured()) {
    getS3Client();
    return;
  }
  if (process.env.PRIVATE_OBJECT_DIR) return;
  throw new Error(
    "MP4 storage is not configured. Enable EthioDeploy object storage or Replit private App Storage.",
  );
}

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

function getObjectKey(objectPath: string): string {
  if (!objectPath.startsWith("/objects/") || objectPath.includes("..")) {
    throw new Error("Saved video object path is invalid.");
  }
  return objectPath.slice(1);
}

export async function saveRenderedVideo(
  buffer: Buffer,
  objectPath: string,
  fileName: string,
): Promise<void> {
  if (isS3Configured()) {
    const { client, bucket } = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: getObjectKey(objectPath),
        Body: buffer,
        ContentType: "video/mp4",
        ContentDisposition: `attachment; filename="${fileName}"`,
        CacheControl: "private, no-store",
      }),
    );
    return;
  }

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
  if (isS3Configured()) {
    const { client, bucket } = getS3Client();
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: getObjectKey(objectPath) }),
    );
    return;
  }

  const { bucketName, objectName } = getObjectLocation(objectPath);
  const signedUrl = await signObjectUrl(bucketName, objectName, "DELETE");
  const response = await fetch(signedUrl, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Saved MP4 cleanup failed (${response.status}).`);
  }
}

export async function openRenderedVideoObject(objectPath: string, range?: string): Promise<Response> {
  if (isS3Configured()) {
    const { client, bucket } = getS3Client();
    try {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: getObjectKey(objectPath),
          ...(range ? { Range: range } : {}),
        }),
      );
      if (!object.Body) return new Response(null, { status: 404 });

      const headers = new Headers({
        "Content-Type": object.ContentType ?? "video/mp4",
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
      });
      if (object.ContentLength !== undefined) {
        headers.set("Content-Length", String(object.ContentLength));
      }
      if (object.ContentRange) {
        headers.set("Content-Range", object.ContentRange);
      }

      return new Response(object.Body.transformToWebStream(), {
        status: object.ContentRange ? 206 : 200,
        headers,
      });
    } catch (error) {
      const details =
        error && typeof error === "object"
          ? (error as { name?: string; $metadata?: { httpStatusCode?: number } })
          : undefined;
      const name = details?.name ?? "";
      const status = details?.$metadata?.httpStatusCode;
      if (
        status === 404 ||
        name === "NoSuchKey" ||
        name === "NotFound" ||
        name === "NoSuchObject"
      ) {
        return new Response(null, { status: 404 });
      }
      if (status === 416 || name === "InvalidRange") {
        return new Response(null, { status: 416 });
      }
      throw error;
    }
  }

  const { bucketName, objectName } = getObjectLocation(objectPath);
  const signedUrl = await signObjectUrl(bucketName, objectName, "GET");
  return fetch(signedUrl, { headers: range ? { Range: range } : undefined });
}
