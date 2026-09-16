import { storage, type TenantScope } from "../../storage";
import { decryptWebhookUrl } from "../webhookSecrets";

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4096;

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

/**
 * Verifies a bot token is valid and that the bot can actually post to the given
 * chat, by sending a real confirmation message - the same "prove it works,
 * don't just store it" pattern used for Discord/Slack webhooks. Returns the
 * chat's display name so the UI can show what got connected.
 */
export async function verifyTelegramBot(botToken: string, chatId: string): Promise<{ ok: true; chatTitle: string } | { error: string }> {
  try {
    const meResponse = await fetch(`${TELEGRAM_API}/bot${botToken}/getMe`);
    const me = (await meResponse.json().catch(() => ({}))) as TelegramApiResponse<{ username?: string }>;
    if (!meResponse.ok || !me.ok) return { error: me.description || "Telegram rejected this bot token" };

    const testMessage = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: "✅ TheSocialPundit is now connected to this chat." }),
    });
    const sent = (await testMessage.json().catch(() => ({}))) as TelegramApiResponse<{ chat?: { title?: string; username?: string; first_name?: string } }>;
    if (!testMessage.ok || !sent.ok) return { error: sent.description || "Telegram rejected the test message - make sure the bot has been added to this chat" };

    const chat = sent.result?.chat;
    const chatTitle = chat?.title || chat?.username || chat?.first_name || chatId;
    return { ok: true, chatTitle };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not reach Telegram to verify this bot" };
  }
}

export async function publishToTelegram(scope: TenantScope, _draftId: string, content: string) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, postId: `sandbox_telegram_${Date.now()}` };

  const account = await storage.getSocialAccountByProvider(scope, "telegram");
  if (!account?.accessToken || !account.providerAccountId) {
    return { success: false, error: "Connect a Telegram bot and chat before publishing" };
  }

  try {
    const botToken = decryptWebhookUrl(account.accessToken);
    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: account.providerAccountId, text: content.slice(0, MAX_MESSAGE_LENGTH) }),
    });
    const json = (await response.json().catch(() => ({}))) as TelegramApiResponse<{ message_id?: number; chat?: { username?: string } }>;
    if (!response.ok || !json.ok || !json.result?.message_id) return { success: false, error: json.description || `Telegram publish failed (${response.status})` };

    const chatUsername = json.result.chat?.username;
    return {
      success: true,
      postId: String(json.result.message_id),
      postUrl: chatUsername ? `https://t.me/${chatUsername}/${json.result.message_id}` : undefined,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Telegram publish failed" };
  }
}
