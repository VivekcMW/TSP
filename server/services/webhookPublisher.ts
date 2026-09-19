import { decryptWebhookUrl } from "./webhookSecrets";
import { storage, type TenantScope } from "../storage";
import { readMedia } from "./mediaStorage";

export const WEBHOOK_PROVIDERS = ["discord", "slack"] as const;
export type WebhookProvider = typeof WEBHOOK_PROVIDERS[number];

const rules: Record<WebhookProvider, RegExp> = {
  discord: /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/,
  slack: /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/,
};

export function isValidWebhookUrl(provider: WebhookProvider, url: string): boolean {
  return rules[provider].test(url);
}

function body(provider: WebhookProvider, content: string) {
  if (provider === "discord") return { content: content.slice(0, 2000), allowed_mentions: { parse: [] } };
  return { text: content };
}

export async function verifyWebhook(provider: WebhookProvider, url: string): Promise<void> {
  const response = await fetch(provider === "discord" ? `${url}?wait=true` : url, {
    method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "TheSocialPundit/1.0" },
    body: JSON.stringify(body(provider, "✅ TheSocialPundit webhook connection verified.")),
  });
  if (!response.ok) throw new Error(`${provider} rejected the webhook (${response.status})`);
}

export async function publishToWebhook(provider: WebhookProvider, scope: TenantScope, content: string, media: Array<{ id: string; name: string }> = []) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, status: "simulated" };
  const account = await storage.getSocialAccountByProvider(scope, provider);
  if (!account?.accessToken) return { success: false, error: `${provider} webhook is not connected` };
  try {
    const url = decryptWebhookUrl(account.accessToken);
    if (!isValidWebhookUrl(provider, url)) return { success: false, error: "Webhook configuration is invalid" };
    const endpoint = provider === "discord" ? `${url}?wait=true` : url;
    const attachments = provider === "discord" ? await Promise.all(media.map(async (item) => {
      const asset = await storage.getMediaAsset(scope, item.id);
      if (!asset) throw new Error("Attached media unavailable");
      return { name: asset.fileName, contentType: asset.contentType, buffer: await readMedia(asset.storageKey) };
    })) : [];
    const uploaded = attachments.filter((item): item is { name: string; contentType: string; buffer: Buffer } => item !== null);
    const form = new FormData();
    let request: RequestInit;
    if (provider === "discord" && uploaded.length) {
      form.append("payload_json", JSON.stringify(body(provider, content)));
      uploaded.forEach((item, index) => form.append(`files[${index}]`, new Blob([item.buffer], { type: item.contentType }), item.name));
      request = { method: "POST", headers: { "User-Agent": "TheSocialPundit/1.0" }, body: form };
    } else {
      request = { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "TheSocialPundit/1.0" }, body: JSON.stringify(body(provider, content)) };
    }
    const response = await fetch(endpoint, { ...request, signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!response.ok) return { success: false, error: `${provider} publish failed (${response.status})` };
    if (provider === "slack") {
      const accepted = (await response.text()).trim() === "ok";
      return { success: accepted, status: accepted ? "accepted_unverified" : "unknown" };
    }
    const data = await response.json().catch(() => ({})) as { id?: string; channel_id?: string };
    return { success: !!data.id, postId: data.id, postUrl: data.id && data.channel_id ? `https://discord.com/channels/@me/${data.channel_id}/${data.id}` : undefined };
  } catch { return { success: false, error: "Webhook delivery could not be confirmed" }; }
}
