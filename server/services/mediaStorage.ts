import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TenantScope } from "../storage";

export interface StoredMediaFile {
  id: string;
  storageKey: string;
}

const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "uploads");

/**
 * Local storage is the safe default. R2/S3 are deliberately configuration-gated
 * until a production adapter with signed requests is supplied; no credentials or
 * fake public URLs are ever used as a fallback.
 */
export function storageProviderName(): "local" | "r2" | "s3" {
  const value = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  return value === "r2" || value === "s3" ? value : "local";
}

function assertLocalProvider(): void {
  const provider = storageProviderName();
  if (provider !== "local") {
    throw new Error(`${provider.toUpperCase()} storage is configured but its production adapter is not installed. Set STORAGE_PROVIDER=local until it is provisioned.`);
  }
}

function keyFor(scope: TenantScope, id: string): string {
  return path.join(scope.tenantId, scope.userId, id);
}

export async function saveMedia(scope: TenantScope, buffer: Buffer): Promise<StoredMediaFile> {
  assertLocalProvider();
  const id = randomUUID();
  const storageKey = keyFor(scope, id);
  const filePath = path.join(uploadRoot, storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer, { flag: "wx", mode: 0o600 });
  return { id, storageKey };
}

export async function readMedia(storageKey: string): Promise<Buffer> {
  assertLocalProvider();
  const filePath = path.resolve(uploadRoot, storageKey);
  if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) throw new Error("Invalid media storage key");
  return readFile(filePath);
}

export async function deleteMedia(storageKey: string): Promise<void> {
  assertLocalProvider();
  const filePath = path.resolve(uploadRoot, storageKey);
  if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) throw new Error("Invalid media storage key");
  await rm(filePath, { force: true });
}