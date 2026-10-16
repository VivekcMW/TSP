import type { Express, Request } from "express";
import multer from "multer";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { createMediaUploadAdmission, mediaUploadLimits } from "../middlewares/mediaUploadAdmission";
import { storage } from "../storage";
import { deleteMedia, readMedia, saveMedia, MEDIA_MAX_BYTES } from "../services/mediaStorage";

// Shared across route registrations/users/tenants in this process, not per app.
const uploadAdmission = createMediaUploadAdmission(mediaUploadLimits(process.env));
const configuredMax = Number(process.env.MAX_FILE_SIZE_MB || 50) * 1024 * 1024;
const MAX_FILE_SIZE = Number.isFinite(configuredMax) && configuredMax > 0 ? Math.min(configuredMax, MEDIA_MAX_BYTES) : MEDIA_MAX_BYTES;
const allowedTypes = new Set((process.env.ALLOWED_MEDIA_TYPES || "image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav").split(","));
// Bound total buffered bytes while parsing, not after 8 large files accumulate.
const requestBytes = new WeakMap<Request, number>();
const pendingBuffers = new WeakMap<Request, Set<() => void>>();
function discardUpload(req: Request) {
  for (const cancel of pendingBuffers.get(req) ?? []) cancel();
  pendingBuffers.delete(req);
  requestBytes.delete(req);
  for (const file of (req.files as Express.Multer.File[] | undefined) ?? []) {
    delete (file as Partial<Express.Multer.File>).buffer;
  }
  delete req.files;
}
const boundedMemory: multer.StorageEngine = {
  _handleFile(req, file, callback) {
    const chunks: Buffer[] = []; let size = 0; let finished = false;
    const pending = pendingBuffers.get(req) ?? new Set<() => void>();
    pendingBuffers.set(req, pending);
    const cleanup = () => {
      chunks.length = 0;
      file.stream.off("data", onData);
      pending.delete(cancel);
    };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true; cleanup(); callback(error);
    };
    const cancel = () => fail(new Error("Upload cancelled"));
    const onData = (chunk: Buffer) => {
      if (finished) return;
      const total = (requestBytes.get(req) ?? 0) + chunk.length;
      requestBytes.set(req, total);
      if (total > MEDIA_MAX_BYTES) return fail(new multer.MulterError("LIMIT_FILE_SIZE"));
      chunks.push(chunk); size += chunk.length;
    };
    pending.add(cancel);
    file.stream.on("data", onData);
    file.stream.once("error", fail);
    file.stream.once("end", () => {
      if (finished) return;
      try {
        const buffer = Buffer.concat(chunks);
        finished = true; cleanup(); callback(null, { buffer, size });
      } catch (error) { fail(error instanceof Error ? error : new Error("Upload buffering failed")); }
    });
  },
  _removeFile(_req, file, callback) { delete (file as Partial<Express.Multer.File>).buffer; callback(null); },
};
const upload = multer({ storage: boundedMemory, limits: { fileSize: MAX_FILE_SIZE, files: 8, fields: 0, parts: 9 }, fileFilter: (_req, file, callback) => {
  if (!allowedTypes.has(file.mimetype)) return callback(new Error("Unsupported media type"));
  callback(null, true);
} });
const receiveUpload = upload.array("files", 8);

function mediaKind(contentType: string): "image" | "video" | "audio" {
  if (contentType.startsWith("image/")) return "image";
  return contentType.startsWith("video/") ? "video" : "audio";
}

export function hasExpectedSignature(file: Pick<Express.Multer.File, "buffer" | "mimetype">): boolean {
  const bytes = file.buffer;
  const startsWith = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (file.mimetype === "image/jpeg") return startsWith(0xff, 0xd8, 0xff);
  if (file.mimetype === "image/png") return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (file.mimetype === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (file.mimetype === "video/mp4") return bytes.toString("ascii", 4, 8) === "ftyp";
  if (file.mimetype === "video/webm") return startsWith(0x1a, 0x45, 0xdf, 0xa3);
  if (file.mimetype === "audio/mpeg") return startsWith(0xff, 0xfb) || startsWith(0xff, 0xf3) || startsWith(0x49, 0x44, 0x33);
  if (file.mimetype === "audio/wav") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
  return false;
}

export function registerMediaRoutes(app: Express) {
  app.post("/api/media/upload", requireDbUser, requirePermission("draft:write:own"), uploadAdmission.wrap(receiveUpload, async (req, res) => {
    const { tenant: scope } = authedOf(req);
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) return res.status(400).json({ message: "Attach at least one supported media file" });
    if (files.reduce((sum, file) => sum + file.size, 0) > MEDIA_MAX_BYTES) return res.status(413).json({ message: "Upload batch exceeds 50 MiB" });
    if (!files.every(hasExpectedSignature)) return res.status(400).json({ message: "One or more files do not match their declared media type" });
    try {
      const assets = await storage.withMediaLock(scope, async repository => {
        const storedFiles: string[] = [];
        try {
          const result = [];
          for (const file of files) {
            const stored = await saveMedia(scope, file.buffer, file.mimetype);
            storedFiles.push(stored.storageKey);
            const asset = await repository.create({ ...stored, fileName: file.originalname.replace(/[\x00-\x1f]/g, "").slice(0, 255), contentType: file.mimetype, sizeBytes: file.size });
            result.push({ id: asset.id, type: mediaKind(asset.contentType), name: asset.fileName, url: `/api/media/${asset.id}`, sizeBytes: asset.sizeBytes });
          }
          return result;
        } catch {
          await Promise.allSettled(storedFiles.map(key => deleteMedia(key)));
          throw new Error("Media batch failed");
        }
      });
      res.status(201).json({ assets });
    } catch {
      console.error("Media upload failed; cleanup may require maintenance");
      res.status(500).json({ message: "Failed to store media" });
    }
  }, discardUpload));

  app.get("/api/media/:id", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" });
    try {
      const asset = await storage.getMediaAsset(authedOf(req).tenant, req.params.id);
      if (!asset || asset.deletionRequestedAt) return res.status(404).json({ message: "Media not found" });
      res.type(asset.contentType).send(await readMedia(asset.storageKey));
    } catch {
      res.status(404).json({ message: "Media file not found" });
    }
  });

  app.delete("/api/media/:id", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    const scope = authedOf(req).tenant;
    try {
      // Commit deletion intent before remote I/O; failures remain repairable.
      await storage.requestMediaDeletion(scope, req.params.id);
      await storage.withMediaLock(scope, async repository => {
        const asset = await repository.get(req.params.id);
        if (!asset) return;
        await deleteMedia(asset.storageKey);
        await repository.remove(asset.id);
      });
      res.status(204).end();
    } catch { res.status(503).json({ message: "Media deletion pending; retry safely" }); }
  });
}