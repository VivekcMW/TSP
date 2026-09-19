/** Implemented application adapters, not the providers' theoretical API features. */
export const PUBLISHING_PLATFORM_KEYS = [
  "linkedin", "twitter", "threads", "bluesky", "substack", "medium", "reddit",
  "mastodon", "devto", "hashnode", "quora", "facebook", "telegram", "discord",
  "farcaster", "xiaohongshu", "weibo", "wechat", "maimai", "vk", "line", "naver", "xing", "slack",
] as const;
export type PublishingMode = "sandbox" | "dry-run" | "live";
export type PublishingIntent = "publish" | "schedule";
export interface PublishingCapability {
  live: boolean;
  text: boolean;
  schedule: boolean;
  auth: "oauth2" | "apikey" | "webhook" | "manual";
  maxCharacters: number;
  mediaTypes: readonly string[];
  maxMedia: number;
  maxMediaBytes: number;
  receipt: "provider_id" | "unavailable";
  verifyDelivery: false;
}
const images = ["image/jpeg", "image/png", "image/webp"];
const audiovisual = [...images, "image/gif", "video/mp4", "audio/mpeg", "audio/wav"];
function live(auth: PublishingCapability["auth"], maxCharacters: number, mediaTypes: readonly string[] = [], maxMedia = 0, maxMediaBytes = 0): PublishingCapability {
  return { live: true, text: true, schedule: true, auth, maxCharacters, mediaTypes, maxMedia, maxMediaBytes, receipt: "provider_id", verifyDelivery: false };
}
const adapters: Record<string, PublishingCapability> = {
  linkedin: live("oauth2", 3000, images, 1, 5 * 1024 * 1024),
  twitter: live("oauth2", 280),
  reddit: live("oauth2", 5000), // Self/text posts only. Never silently drop media.
  bluesky: live("apikey", 300, images, 4, 1_000_000),
  mastodon: live("apikey", 500, audiovisual, 4, 8 * 1024 * 1024),
  devto: live("apikey", 5000, images, 1, 5 * 1024 * 1024),
  hashnode: live("apikey", 5000),
  telegram: live("apikey", 4096),
  discord: live("webhook", 2000, audiovisual, 8, 8 * 1024 * 1024),
  slack: { ...live("webhook", 4000), receipt: "unavailable" },
};
const manual: PublishingCapability = { live: false, text: false, schedule: false, auth: "manual", maxCharacters: 5000, mediaTypes: [], maxMedia: 0, maxMediaBytes: 0, receipt: "unavailable", verifyDelivery: false };
export const PUBLISHING_CAPABILITIES: Readonly<Record<string, PublishingCapability>> = Object.fromEntries(
  PUBLISHING_PLATFORM_KEYS.map(key => [key, adapters[key] ?? { ...manual }]),
);
export const DIRECT_PUBLISH_PLATFORMS = PUBLISHING_PLATFORM_KEYS.filter(key => PUBLISHING_CAPABILITIES[key].live);
export function publishingCapability(platform: string): PublishingCapability | undefined {
  return Object.hasOwn(PUBLISHING_CAPABILITIES, platform) ? PUBLISHING_CAPABILITIES[platform] : undefined;
}
export function supportedPublishingCapabilities(platform: string): string[] {
  const capability = publishingCapability(platform);
  if (!capability) return [];
  return [...(capability.live ? ["publish", "schedule"] : []), ...(capability.maxMedia ? ["media"] : []), ...(capability.auth === "oauth2" ? ["oauth"] : [])];
}