import type { Express, RequestHandler } from "express";
import multer from "multer";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { storage } from "../storage";
import { deleteMedia, readMedia, saveMedia } from "../services/mediaStorage";

const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE_MB || 50) * 1024 * 1024;
const allowedTypes = new Set((process.env.ALLOWED_MEDIA_TYPES || "image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav").split(","));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 8 }, fileFilter: (_req, file, callback) => callback(null, allowedTypes.has(file.mimetype)) });

function mediaKind(contentType: string): "image" | "video" | "audio" {
  return contentType.startsWith("image/") ? "image" : contentType.startsWith("video/") ? "video" : "audio";
}

function hasExpectedSignature(file: Express.Multer.File): boolean {
  const bytes = file.buffer;
  const startsWith = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (file.mimetype === "image/jpeg") return startsWith(0xff, 0xd8, 0xff);
  if (file.mimetype === "image/png") return startsWith(0x89, 0x50, 0x4e, 0x47);
  if (file.mimetype === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (file.mimetype === "video/mp4") return bytes.toString("ascii", 4, 8) === "ftyp";
  if (file.mimetype === "video/webm") return startsWith(0x1a, 0x45, 0xdf, 0xa3);
  if (file.mimetype === "audio/mpeg") return startsWith(0xff, 0xfb) || startsWith(0xff, 0xf3) || startsWith(0x49, 0x44, 0x33);
  if (file.mimetype === "audio/wav") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
  return false;
}

export function registerMediaRoutes(app: Express) {
  app.post("/api/media/upload", requireDbUser, requirePermission("draft:write:own"), upload.array("files", 8) as RequestHandler, async (req, res) => {
    const { tenant: scope } = authedOf(req);
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) return res.status(400).json({ message: "Attach at least one supported media file" });
    if (!files.every(hasExpectedSignature)) return res.status(400).json({ message: "One or more files do not match their declared media type" });
    try {
      const assets = await Promise.all(files.map(async (file) => {
        const stored = await saveMedia(scope, file.buffer);
        const asset = await storage.createMediaAsset(scope, { id: stored.id, fileName: file.originalname.slice(0, 255), contentType: file.mimetype, sizeBytes: file.size, storageKey: stored.storageKey });
        return { id: asset.id, type: mediaKind(asset.contentType), name: asset.fileName, url: `/api/media/${asset.id}`, sizeBytes: asset.sizeBytes };
      }));
      res.status(201).json({ assets });
    } catch (error) {
      console.error("Media upload failed:", error);
      res.status(500).json({ message: "Failed to store media" });
    }
  });

  app.get("/api/media/:id", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    const asset = await storage.getMediaAsset(authedOf(req).tenant, req.params.id);
    if (!asset) return res.status(404).json({ message: "Media not found" });
    try {
      res.type(asset.contentType).send(await readMedia(asset.storageKey));
    } catch {
      res.status(404).json({ message: "Media file not found" });
    }
  });

  app.delete("/api/media/:id", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    const scope = authedOf(req).tenant;
    const asset = await storage.getMediaAsset(scope, req.params.id);
    if (!asset) return res.status(404).json({ message: "Media not found" });
    await deleteMedia(asset.storageKey);
    await storage.deleteMediaAsset(scope, asset.id);
    res.status(204).end();
  });
}