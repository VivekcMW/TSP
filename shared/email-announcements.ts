import { z } from "zod";

export const announcementTypes = ["product_update", "maintenance", "incident"] as const;
export const announcementSchema = z.object({
  type: z.enum(announcementTypes),
  title: z.string().trim().min(3).max(160).refine(value => !/[\r\n]/.test(value), "Use a single-line title"),
  body: z.string().trim().min(10).max(5000),
  actionLabel: z.string().trim().min(1).max(60),
  actionUrl: z.string().trim().url().max(2048).pipe(z.string().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Use an HTTPS link without credentials")),
}).strict();

export type Announcement = z.infer<typeof announcementSchema>;
export interface AnnouncementCampaign {
  id: string;
  content: Announcement;
  status: "draft" | "active" | "paused" | "completed";
  createdAt: string;
  audienceCount: number;
  processedCount: number;
  sentCount: number;
  suppressedCount: number;
  unknownCount: number;
  failedCount: number;
}
export interface AnnouncementPreview {
  campaign: AnnouncementCampaign;
  html: string;
}
