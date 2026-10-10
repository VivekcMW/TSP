import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";

export interface ObjectLocation { bucket: string; region: string; endpoint?: string }
export type RemoteBackend = "s3" | "r2";
export function configuredLocation(backend: RemoteBackend): ObjectLocation {
  const prefix = backend.toUpperCase();
  const bucket = process.env[`${prefix}_BUCKET`];
  const region = process.env[`${prefix}_REGION`] || (backend === "r2" ? "auto" : "us-east-1");
  const endpoint = process.env[`${prefix}_ENDPOINT`];
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Private media bucket is not configured");
  if (backend === "r2" && !endpoint) throw new Error("R2 endpoint is not configured");
  if (endpoint) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid private storage endpoint");
  }
  return { bucket, region, ...(endpoint ? { endpoint } : {}) };
}

function clientFor(backend: RemoteBackend, location: ObjectLocation) {
  // Stored locators cannot redirect credentials to an arbitrary host/bucket.
  // Keep old backend config available until its assets have been migrated.
  const config = configuredLocation(backend);
  if (config.bucket !== location.bucket || config.region !== location.region || config.endpoint !== location.endpoint) throw new Error("Stored media location differs from configured backend; restore its configuration");
  const prefix = backend.toUpperCase();
  const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`];
  const secretAccessKey = process.env[`${prefix}_SECRET_ACCESS_KEY`];
  if (!accessKeyId || !secretAccessKey) throw new Error("Private media credentials are not configured");
  return new S3Client({ region: location.region, endpoint: location.endpoint, credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 2, requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
}

async function withClient<T>(backend: RemoteBackend, location: ObjectLocation, work: (client: S3Client, signal: AbortSignal) => Promise<T>): Promise<T> {
  const client = clientFor(backend, location);
  try { return await work(client, AbortSignal.timeout(30_000)); }
  catch { throw new Error("Private media operation failed"); }
  finally { client.destroy(); }
}
export async function putObject(backend: RemoteBackend, location: ObjectLocation, key: string, body: Buffer, contentType: string) {
  await withClient(backend, location, (client, signal) => client.send(new PutObjectCommand({ Bucket: location.bucket, Key: key,
    Body: body, ContentLength: body.length, ContentType: contentType, CacheControl: "private, no-store" }), { abortSignal: signal }));
}
export async function getObject(backend: RemoteBackend, location: ObjectLocation, key: string, maxBytes: number) {
  return withClient(backend, location, async (client, signal) => {
    const result = await client.send(new GetObjectCommand({ Bucket: location.bucket, Key: key }), { abortSignal: signal });
    if (!result.Body || (result.ContentLength !== undefined && result.ContentLength > maxBytes)) {
      (result.Body as { destroy?: () => void } | undefined)?.destroy?.();
      throw new Error("Media exceeds size limit");
    }
    const chunks: Buffer[] = []; let size = 0;
    // Bound actual streamed bytes too, not just a possibly missing length header.
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > maxBytes) { (result.Body as { destroy?: () => void }).destroy?.(); throw new Error("Media exceeds size limit"); }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  });
}
export async function removeObject(backend: RemoteBackend, location: ObjectLocation, key: string) {
  await withClient(backend, location, (client, signal) => client.send(new DeleteObjectCommand({ Bucket: location.bucket, Key: key }), { abortSignal: signal }));
}
export async function listObjects(backend: RemoteBackend, location: ObjectLocation, prefix: string, after?: string) {
  return withClient(backend, location, async (client, signal) => {
    const result = await client.send(new ListObjectsV2Command({ Bucket: location.bucket, Prefix: prefix, StartAfter: after, MaxKeys: 100 }), { abortSignal: signal });
    return (result.Contents ?? []).slice(0, 100).map(item => ({ key: item.Key ?? "", modified: item.LastModified }));
  });
}
export async function objectAge(backend: RemoteBackend, location: ObjectLocation, key: string) {
  return withClient(backend, location, async (client, signal) =>
    (await client.send(new HeadObjectCommand({ Bucket: location.bucket, Key: key }), { abortSignal: signal })).LastModified);
}