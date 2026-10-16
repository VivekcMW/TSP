import { mkdir, readFile, rm, writeFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TenantScope } from "../storage";
import { configuredLocation, putObject, getObject, removeObject, type ObjectLocation } from "./media-object-store";

export interface StoredMediaFile {
  id: string;
  storageKey: string;
  storageBackend: "local" | "s3" | "r2";
  storageLocation: ObjectLocation | null;
}

const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "uploads");
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const component = /^[A-Za-z0-9_-]{1,128}$/;
const assetId = /^[a-f0-9-]{36}$/;
export function mediaPrefix(scope: TenantScope) {
  if (!component.test(scope.tenantId) || !component.test(scope.userId)) throw new Error("Invalid media scope");
  return `tsp-media/v1/${scope.tenantId}/${scope.userId}/`;
}
export function encodeMediaLocator(backend: "s3" | "r2", location: ObjectLocation, key: string) {
  return `media:v1:${Buffer.from(JSON.stringify({ backend, location, key })).toString("base64url")}`;
}
export function decodeMediaLocator(storageKey: string) {
  if (!storageKey.startsWith("media:v1:")) return undefined;
  if (storageKey.length > 4096) throw new Error("Invalid media locator");
  const value = JSON.parse(Buffer.from(storageKey.slice(9), "base64url").toString()) as { backend: "s3" | "r2"; location: ObjectLocation; key: string };
  if (!["s3", "r2"].includes(value.backend) || !value.location || !/^tsp-media\/v1\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[a-f0-9-]{36}$/.test(value.key)) throw new Error("Invalid media locator");
  return value;
}

/**
 * New writes use configured storage; existing reads use their immutable locator.
 * Remote keys are versioned so existing publishers' readMedia(key) API stays valid.
 */
export function storageProviderName(): "local" | "r2" | "s3" {
  const value = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  if (!["local", "s3", "r2"].includes(value)) throw new Error("Invalid storage provider");
  return value as "local" | "s3" | "r2";
}

function localFile(storageKey: string) {
  const parts = storageKey.split("/");
  if (parts.length !== 3 || !parts.every(part => component.test(part)) || !assetId.test(parts[2])) throw new Error("Invalid media storage key");
  return path.join(uploadRoot, ...parts);
}
async function checkedLocalFile(key: string) {
  const file = localFile(key);
  const [root, actual] = await Promise.all([realpath(uploadRoot), realpath(file)]);
  if (!actual.startsWith(`${root}${path.sep}`)) throw new Error("Invalid media storage key");
  return actual;
}

export async function saveMedia(scope: TenantScope, buffer: Buffer, contentType = "application/octet-stream"): Promise<StoredMediaFile> {
  if (!buffer.length || buffer.length > MEDIA_MAX_BYTES) throw new Error("Invalid media size");
  const id = randomUUID();
  const prefix = mediaPrefix(scope);
  const storageBackend = storageProviderName();
  if (storageBackend !== "local") {
    const storageLocation = configuredLocation(storageBackend);
    const key = `${prefix}${id}`;
    try { await putObject(storageBackend, storageLocation, key, buffer, contentType); }
    catch {
      // PUT could have reached the server before a timeout. Best-effort cleanup;
      // bounded aged orphan maintenance repairs a second failure.
      await removeObject(storageBackend, storageLocation, key).catch(() => undefined);
      throw new Error("Private media upload failed");
    }
    return { id, storageKey: encodeMediaLocator(storageBackend, storageLocation, key), storageBackend, storageLocation };
  }
  const storageKey = `${scope.tenantId}/${scope.userId}/${id}`;
  const filePath = localFile(storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  const [root, parent] = await Promise.all([realpath(uploadRoot), realpath(path.dirname(filePath))]);
  if (!parent.startsWith(`${root}${path.sep}`)) throw new Error("Invalid media directory");
  await writeFile(filePath, buffer, { flag: "wx", mode: 0o600 });
  return { id, storageKey, storageBackend, storageLocation: null };
}

export async function readMedia(storageKey: string): Promise<Buffer> {
  const locator = decodeMediaLocator(storageKey);
  if (locator) return getObject(locator.backend, locator.location, locator.key, MEDIA_MAX_BYTES);
  const filePath = await checkedLocalFile(storageKey);
  if ((await stat(filePath)).size > MEDIA_MAX_BYTES) throw new Error("Media exceeds size limit");
  return readFile(filePath);
}

export async function deleteMedia(storageKey: string): Promise<void> {
  const locator = decodeMediaLocator(storageKey);
  if (locator) return removeObject(locator.backend, locator.location, locator.key);
  try { await rm(await checkedLocalFile(storageKey), { force: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}