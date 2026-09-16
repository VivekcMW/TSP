import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSocialAccountByProvider, decryptWebhookUrl } = vi.hoisted(() => ({ getSocialAccountByProvider: vi.fn(), decryptWebhookUrl: vi.fn() }));
vi.mock("../../storage", () => ({ storage: { getSocialAccountByProvider } }));
vi.mock("../webhookSecrets", () => ({ decryptWebhookUrl }));

import { publishToTelegram, verifyTelegramBot } from "./telegram";

describe("Telegram publisher", () => {
  beforeEach(() => {
    process.env.PUBLISHING_MODE = "live";
    getSocialAccountByProvider.mockResolvedValue({ providerAccountId: "@mychannel", accessToken: "encrypted" });
    decryptWebhookUrl.mockReturnValue("bot-token");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("sends the draft content to the connected chat", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 7, chat: { username: "mychannel" } } }), { status: 200 }),
    );
    const result = await publishToTelegram({ tenantId: "tenant", userId: "user" }, "draft", "A Telegram post");
    expect(result).toEqual({ success: true, postId: "7", postUrl: "https://t.me/mychannel/7" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/botbot-token/sendMessage",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"chat_id":"@mychannel"') }),
    );
  });

  it("fails without ever calling Telegram when no chat is connected", async () => {
    getSocialAccountByProvider.mockResolvedValue(undefined);
    const result = await publishToTelegram({ tenantId: "tenant", userId: "user" }, "draft", "A Telegram post");
    expect(result).toEqual({ success: false, error: "Connect a Telegram bot and chat before publishing" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces Telegram's own error when the send fails", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was kicked from the channel" }), { status: 403 }));
    const result = await publishToTelegram({ tenantId: "tenant", userId: "user" }, "draft", "A Telegram post");
    expect(result).toEqual({ success: false, error: "Forbidden: bot was kicked from the channel" });
  });
});

describe("verifyTelegramBot", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("rejects an invalid bot token before attempting to message the chat", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }));
    const result = await verifyTelegramBot("bad-token", "@mychannel");
    expect(result).toEqual({ error: "Unauthorized" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects when the token is valid but the bot cannot message the chat", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { username: "mybot" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 }));
    const result = await verifyTelegramBot("good-token", "@missingchannel");
    expect(result).toEqual({ error: "Bad Request: chat not found" });
  });

  it("confirms and returns the chat title on success", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { username: "mybot" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { chat: { title: "My Channel" } } }), { status: 200 }));
    const result = await verifyTelegramBot("good-token", "@mychannel");
    expect(result).toEqual({ ok: true, chatTitle: "My Channel" });
  });
});
