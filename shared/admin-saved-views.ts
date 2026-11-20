import { z } from "zod";

const destination = z.string().max(1500).refine(value => {
  if (!value.startsWith("/admin/")) return false;
  const url = new URL(value, "https://admin.invalid");
  return url.origin === "https://admin.invalid" && ["/admin/search", "/admin/tenants", "/admin/users", "/admin/audit-log", "/admin/email-deliveries"].includes(url.pathname)
    && !url.hash;
}, "Use an admin investigation directory");
export const savedViewSchema = z.object({ name: z.string().trim().min(1).max(60), href: destination }).strict();
export const savedViewsSchema = z.array(savedViewSchema).max(10);
export type AdminSavedView = z.infer<typeof savedViewSchema>;
