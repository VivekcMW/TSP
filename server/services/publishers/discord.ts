import { storage, type TenantScope } from "../../storage";
import { decryptWebhookUrl } from "../webhookSecrets";

export async function publishToDiscord(scope: TenantScope, draftId: string, content: string) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, postId: `sandbox_discord_${Date.now()}` };
  const account = await storage.getSocialAccountByProvider(scope, "discord");
  if (!account?.accessToken) return { success: false, error: "Discord webhook is not connected" };
  try {
    const webhookUrl = decryptWebhookUrl(account.accessToken);
    const response = await fetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "TheSocialPundit/1.0" },
      body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: [] } }),
    });
    if (!response.ok) return { success: false, error: `Discord publish failed (${response.status})` };
    const message = await response.json() as { id?: string; channel_id?: string };
    if (!message.id) return { success: false, error: "Discord did not return a message ID" };
    return { success: true, postId: message.id, postUrl: message.channel_id ? `https://discord.com/channels/@me/${message.channel_id}/${message.id}` : undefined };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Discord publish failed" };
  }
}
