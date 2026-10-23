import { createHash } from "node:crypto";
import { storage, type TenantScope } from "../storage";
import { configuredLocation, getObject, listObjects, objectAge, putObject, removeObject, type RemoteBackend } from "./media-object-store";
import { deleteMedia, encodeMediaLocator, mediaPrefix, readMedia, MEDIA_MAX_BYTES } from "./mediaStorage";

export type MediaMaintenanceOptions = { dryRun?: boolean; after?: string };

/** Explicit operator invocation only. One scoped page, stable IDs, deterministic
 * target keys and read-back verification make retries resumable. Never deletes
 * local originals, even in apply mode. */
export async function migrateLocalMedia(scope: TenantScope, backend: RemoteBackend, options: MediaMaintenanceOptions = {}) {
  const prefix = mediaPrefix(scope);
  const location = configuredLocation(backend);
  const dryRun = options.dryRun !== false;
  return storage.withMediaLock(scope, async repository => {
    const rows = await repository.list(options.after);
    let candidates = 0; let updated = 0;
    for (const asset of rows) {
      if (asset.storageBackend !== "local" || asset.deletionRequestedAt) continue;
      if (asset.storageKey !== `${scope.tenantId}/${scope.userId}/${asset.id}`) throw new Error("Local media locator does not match owner");
      candidates++;
      if (dryRun) continue;
      const body = await readMedia(asset.storageKey);
      if (body.length !== asset.sizeBytes) throw new Error("Local media size mismatch");
      const key = `${prefix}${asset.id}`;
      await putObject(backend, location, key, body, asset.contentType);
      const copied = await getObject(backend, location, key, MEDIA_MAX_BYTES);
      const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");
      if (digest(body) !== digest(copied)) throw new Error("Media migration verification failed");
      await repository.relocate(asset.id, { storageBackend: backend, storageLocation: location, storageKey: encodeMediaLocator(backend, location, key) });
      updated++;
    }
    return { dryRun, scanned: rows.length, candidates, updated, nextAfter: rows.at(-1)?.id ?? options.after ?? null, done: rows.length < 100 };
  });
}

export async function repairMediaDeletions(scope: TenantScope, options: MediaMaintenanceOptions = {}) {
  mediaPrefix(scope);
  return storage.withMediaLock(scope, async repository => {
    const rows = await repository.list(options.after);
    let candidates = 0;
    for (const asset of rows) {
      if (!asset.deletionRequestedAt) continue;
      candidates++;
      if (options.dryRun !== false) continue;
      await deleteMedia(asset.storageKey);
      await repository.remove(asset.id);
    }
    return { dryRun: options.dryRun !== false, scanned: rows.length, candidates, nextAfter: rows.at(-1)?.id ?? options.after ?? null, done: rows.length < 100 };
  });
}

/** Never scans a bucket root. Only generated UUID keys in this exact owner
 * namespace, older than 24h, without a DB reference. Same lock as all writers. */
export async function cleanMediaOrphans(scope: TenantScope, backend: RemoteBackend, options: MediaMaintenanceOptions = {}, now = new Date()) {
  const prefix = mediaPrefix(scope);
  const location = configuredLocation(backend);
  if (options.after && !options.after.startsWith(prefix)) throw new Error("Invalid orphan cursor scope");
  const cutoff = now.getTime() - 86_400_000;
  return storage.withMediaLock(scope, async repository => {
    const rows = await listObjects(backend, location, prefix, options.after);
    let candidates = 0; let deleted = 0;
    for (const row of rows) {
      if (!row.key.startsWith(prefix) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.key.slice(prefix.length))
        || !row.modified || row.modified.getTime() > cutoff) continue;
      if (await repository.referenced(encodeMediaLocator(backend, location, row.key))) continue;
      candidates++;
      if (options.dryRun !== false) continue;
      const modified = await objectAge(backend, location, row.key);
      if (!modified || modified.getTime() > cutoff) continue;
      await removeObject(backend, location, row.key);
      deleted++;
    }
    return { dryRun: options.dryRun !== false, scanned: rows.length, candidates, deleted, nextAfter: rows.at(-1)?.key ?? options.after ?? null, done: rows.length < 100 };
  });
}