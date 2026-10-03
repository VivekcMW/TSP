import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailPreferenceDefaults } from "@shared/email-preferences";

const m = vi.hoisted(() => {
  vi.stubEnv("RESEND_API_KEY", "test-placeholder-not-real");
  return { send: vi.fn(), allowed: vi.fn(), preferences: vi.fn(), claim: vi.fn(), begin: vi.fn(),
    finish: vi.fn(), process: vi.fn(), add: vi.fn(), on: vi.fn() };
});
vi.mock("resend", () => ({ Resend: class { emails = { send: m.send }; } }));
vi.mock("bull", () => ({ default: class { process = m.process; add = m.add; on = m.on; close = vi.fn(); } }));
vi.mock("../invitations-store", () => ({ invitationDeliveryAllowed: m.allowed }));
vi.mock("./preferences", () => ({ getEmailPreferences: m.preferences }));
vi.mock("./delivery-store", () => ({
  claimDelivery: m.claim, beginDelivery: m.begin, finishDelivery: m.finish, recoverEmailDeliveries: vi.fn(),
  deliveryKey: (email: AppEmail) => typeof email.dedupeKey === "string" && email.dedupeKey.trim() ? "hashed-key" : null,
}));
import { closeEmailQueue, deliverAppEmail, getInvitationDeliveryConfiguration, initializeEmailQueue,
  registerEmailWorker, sendAppEmail, type AppEmail } from "./index";
import { isEssentialEmail, preferenceEnabled } from "./policy";

const origin = "https://app.example.invalid";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const token = "ab".repeat(32);
const unsubscribe = `${origin}/invitation-preferences#token=${token}`;
const claim = { id: "delivery", token: "fence" };
const email: AppEmail = { type: "friend_invitation", invitationId: id, recipient: "friend@example.invalid",
  subject: "A friend's invitation", html: "<p>Come join us.</p>", text: "Come join us.",
  dedupeKey: `friend-invitation:${id}`, invitationUnsubscribeUrl: unsubscribe };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1");
  vi.stubEnv("EMAIL_QUEUE_ENABLED", "true");
  m.allowed.mockResolvedValue(true);
  m.claim.mockResolvedValue(claim);
  m.begin.mockResolvedValue(true);
  m.send.mockResolvedValue({ data: { id: "receipt" }, error: null });
  // All infrastructure is mocked; even loopback network is forbidden here.
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Fetch forbidden"); }));
  for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(async () => {
  await closeEmailQueue();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function worker() {
  initializeEmailQueue();
  registerEmailWorker();
  return m.process.mock.calls[0][1] as (job: { data: AppEmail; discard?: () => void }) => Promise<unknown>;
}
function expectNoDispatch() {
  expect(m.claim).not.toHaveBeenCalled();
  expect(m.begin).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
  expect(m.add).not.toHaveBeenCalled();
}

describe("invitation delivery identity", () => {
  it.each([
    { invitationId: undefined }, { invitationId: "" }, { invitationId: "not-a-uuid" }, { invitationId: 42 },
    { invitationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { dedupeKey: undefined }, { dedupeKey: "" }, { dedupeKey: "arbitrary" },
    { dedupeKey: `friend-invitation:${id}:retry` }, { dedupeKey: ` friend-invitation:${id}` },
    { userId: "inviter-account" }, { userId: "" }, { userId: null },
    { invitationUnsubscribeUrl: undefined }, { invitationUnsubscribeUrl: 42 },
  ])("rejects malformed identity %# before storage, enqueue or provider", async change => {
    initializeEmailQueue();
    const input = { ...email, ...change } as AppEmail;
    expect(await deliverAppEmail(input)).toEqual({ skipped: true });
    expect(await sendAppEmail(input)).toEqual({ skipped: true });
    expect(m.allowed).not.toHaveBeenCalled();
    expect(m.preferences).not.toHaveBeenCalled();
    expectNoDispatch();
    expect(input).toEqual({ ...email, ...change });
  });

  it("binds both policy checks to the reservation and recipient without attributing an inviter", async () => {
    expect(await deliverAppEmail(email)).toEqual({ messageId: "receipt" });
    expect(m.allowed.mock.calls).toEqual([[id, email.recipient], [id, email.recipient]]);
    expect(m.claim).toHaveBeenCalledWith(email);
    expect(m.claim.mock.calls[0][0]).not.toHaveProperty("userId");
    expect(m.preferences).not.toHaveBeenCalled();
    expect(m.finish).toHaveBeenCalledWith(claim, "sent", "receipt");
  });

  it("does not classify invitations as essential or let required bypass recipient opt-out", async () => {
    expect(isEssentialEmail("friend_invitation")).toBe(false);
    expect(preferenceEnabled("friend_invitation", { ...emailPreferenceDefaults, unsubscribedAt: new Date() })).toBe(false);
    m.allowed.mockResolvedValue(false);
    expect(await deliverAppEmail({ ...email, required: true })).toEqual({ skipped: true });
    expectNoDispatch();
  });

  it("suppresses an opt-out after claim, before begin/provider", async () => {
    m.allowed.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await deliverAppEmail(email)).toEqual({ skipped: true });
    expect(m.finish).toHaveBeenCalledExactlyOnceWith(claim, "suppressed");
    expect(m.begin).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("fails closed on policy storage failure", async () => {
    m.allowed.mockRejectedValue(new Error("Policy unavailable"));
    await expect(sendAppEmail(email)).rejects.toThrow("Policy unavailable");
    expectNoDispatch();
  });
});

describe("reusable invitation delivery configuration", () => {
  it.each([origin, `${origin}/`])("accepts canonical HTTPS config %s", configured => {
    vi.stubEnv("APP_URL", configured);
    expect(getInvitationDeliveryConfiguration()).toEqual({ origin,
      invitationPreferencesUrl: `${origin}/invitation-preferences`, privacyUrl: `${origin}/privacy` });
  });

  it.each([undefined, "", "not-url", "//app.example.invalid", "https://", "javascript:alert(1)",
    "ftp://app.example.invalid", "http://app.example.invalid", "http://localhost:4300",
    `${origin}/dashboard`, `${origin}/?query=1`, `${origin}/#fragment`, `${origin}?`, `${origin}#`,
    "https://user:password@app.example.invalid", "https://app.example.invalid\\", ` ${origin}`,
  ])("fails closed for invalid or noncanonical APP_URL %#", async configured => {
    vi.stubEnv("APP_URL", configured);
    expect(getInvitationDeliveryConfiguration()).toBeUndefined();
    initializeEmailQueue();
    expect(await deliverAppEmail(email)).toEqual({ skipped: true });
    expect(await sendAppEmail(email)).toEqual({ skipped: true });
    expect(m.allowed).not.toHaveBeenCalled();
    expectNoDispatch();
  });

  it.each(["http://localhost:4300", "http://127.0.0.1:4300", "http://[::1]:4300"])("permits local HTTP only in development: %s", async configured => {
    vi.stubEnv("APP_URL", configured);
    for (const mode of ["production", "test", "staging"]) {
      vi.stubEnv("NODE_ENV", mode);
      expect(getInvitationDeliveryConfiguration()).toBeUndefined();
    }
    vi.stubEnv("NODE_ENV", "development");
    expect(getInvitationDeliveryConfiguration()?.origin).toBe(configured);
    expect(await deliverAppEmail({ ...email, invitationUnsubscribeUrl: `${configured}/invitation-preferences#token=${token}` }))
      .toEqual({ messageId: "receipt" });
  });

  it.each(["http://app.example.invalid", "http://localhost.evil.invalid", "http://192.168.1.1"])("rejects nonlocal development HTTP: %s", configured => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", configured);
    expect(getInvitationDeliveryConfiguration()).toBeUndefined();
  });

  it.each([
    `${origin}/invitation-preferences`, `${origin}/invitation-preferences?token=${token}`,
    `${origin}/invitation-preferences/#token=${token}`, `${origin}/invitation-preferences?x=1#token=${token}`,
    `${origin}/dashboard/settings#token=${token}`, `https://other.example.invalid/invitation-preferences#token=${token}`,
    `${origin}:8443/invitation-preferences#token=${token}`, `http://app.example.invalid/invitation-preferences#token=${token}`,
    `https://user@app.example.invalid/invitation-preferences#token=${token}`, `/invitation-preferences#token=${token}`,
    `${origin}/x/../invitation-preferences#token=${token}`, `${origin}/invitation-preferences#token=abc`,
    `${unsubscribe}a`, `${unsubscribe}&other=value`, `${unsubscribe}\n`,
    `${origin}/invitation-preferences#token=${"g".repeat(64)}`,
  ])("rejects malformed/cross-origin unsubscribe link %#", async invitationUnsubscribeUrl => {
    initializeEmailQueue();
    const input = { ...email, invitationUnsubscribeUrl };
    expect(await deliverAppEmail(input)).toEqual({ skipped: true });
    expect(await sendAppEmail(input)).toEqual({ skipped: true });
    expect(m.allowed).not.toHaveBeenCalled();
    expectNoDispatch();
  });
});

describe("invitation email rendering", () => {
  it("escapes recipient names and includes unauthenticated opt-out/privacy in both parts", async () => {
    const recipientName = '<b>Friend & "Co"</b>';
    await deliverAppEmail({ ...email, recipientName });
    const { html, text } = m.send.mock.calls[0][0];
    expect(html).toContain("Hi &lt;b&gt;Friend &amp; &quot;Co&quot;&lt;/b&gt;,");
    expect(html).not.toContain(recipientName);
    expect(html).toContain(`href="${unsubscribe}"`);
    expect(html).toContain(">Stop invitation emails</a>");
    expect(html).toContain(`href="${origin}/privacy"`);
    expect(text).toContain(`Hi ${recipientName},`);
    expect(text).toContain(`Stop invitation emails: ${unsubscribe}`);
    expect(text).toContain(`Privacy: ${origin}/privacy`);
    for (const part of [html, text]) expect(part).not.toMatch(/dashboard\/settings|Manage email preferences/);
  });

  it.each([undefined, ""])("uses Hi there without a name (%j), keeps afterCta signoff once", async recipientName => {
    await deliverAppEmail({ ...email, recipientName, text: undefined,
      primaryCta: { label: "Join", url: `${origin}/sign-up` },
      afterCta: "<p>The Founding Team<br>TheSocialPundit</p>" });
    const { html, text } = m.send.mock.calls[0][0];
    expect(html).toContain("<p>Hi there,</p>");
    expect(text).toMatch(/^Hi there,\n\nCome join us\./);
    expect(text).toContain(`Join: ${origin}/sign-up`);
    for (const part of [html, text]) expect(part.match(/The Founding Team/g)).toHaveLength(1);
    expect(text.match(/TheSocialPundit/g)).toHaveLength(1);
    expect(text).toContain(`Stop invitation emails: ${unsubscribe}`);
  });
});

describe("queued invitation policy", () => {
  it("checks before enqueue and returns queued only for invitations", async () => {
    worker();
    expect(await sendAppEmail(email)).toEqual({ queued: true });
    expect(m.allowed).toHaveBeenCalledExactlyOnceWith(id, email.recipient);
    expect(m.add).toHaveBeenCalledWith(email, { jobId: "hashed-key" });
    expect(m.claim).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
    expect(await sendAppEmail({ type: "verification", recipient: email.recipient, subject: "Verify", html: "Body" }))
      .toEqual({ skipped: true });
    expect(m.allowed).toHaveBeenCalledTimes(1);
  });

  it("never enqueues an opted-out invitation", async () => {
    worker();
    m.allowed.mockResolvedValue(false);
    expect(await sendAppEmail(email)).toEqual({ skipped: true });
    expectNoDispatch();
  });

  it("rechecks a queued invitation before claim when its recipient opts out", async () => {
    const dispatch = worker();
    await sendAppEmail(email);
    m.allowed.mockResolvedValue(false);
    expect(await dispatch({ data: m.add.mock.calls[0][0] })).toEqual({ skipped: true });
    expect(m.claim).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("rechecks again after a queued claim and records suppressed on opt-out", async () => {
    const dispatch = worker();
    m.allowed.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await sendAppEmail(email);
    expect(await dispatch({ data: m.add.mock.calls[0][0] })).toEqual({ skipped: true });
    expect(m.allowed).toHaveBeenCalledTimes(3);
    expect(m.finish).toHaveBeenCalledExactlyOnceWith(claim, "suppressed");
    expect(m.begin).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("revalidates retained payload identity and current configuration", async () => {
    const dispatch = worker();
    expect(await dispatch({ data: { ...email, dedupeKey: "arbitrary" } })).toEqual({ skipped: true });
    vi.stubEnv("APP_URL", "https://new.example.invalid");
    expect(await dispatch({ data: email })).toEqual({ skipped: true });
    expectNoDispatch();
  });
});

describe("invitation transport uncertainty", () => {
  it("leaves a timed-out invitation unknown even when a late receipt arrives", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    m.send.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const assertion = expect(deliverAppEmail(email)).rejects.toThrow("outcome is unknown");
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    resolve({ data: { id: "late-receipt" }, error: null });
    await Promise.resolve();
    expect(m.finish).toHaveBeenCalledExactlyOnceWith(claim, "unknown");
    expect(m.send).toHaveBeenCalledTimes(1);
    for (const method of ["log", "warn", "error"] as const) expect(console[method]).not.toHaveBeenCalled();
  });

  it.each(["exception", "application_error", "missing-receipt"])("records %s as unknown, never failed or logged with PII", async failure => {
    if (failure === "exception") m.send.mockRejectedValue(new Error(`${email.recipient} ${token}`));
    else if (failure === "application_error") m.send.mockResolvedValue({ error: { name: failure, message: `${email.recipient} ${token}` } });
    else m.send.mockResolvedValue({ data: null, error: null });
    await expect(deliverAppEmail(email)).rejects.toThrow(/unknown|receipt missing/);
    expect(m.finish).toHaveBeenCalledExactlyOnceWith(claim, "unknown");
    // A retained unknown delivery is not claimable; no second provider call.
    m.claim.mockResolvedValue(undefined);
    expect(await deliverAppEmail(email)).toEqual({ skipped: true });
    expect(m.send).toHaveBeenCalledTimes(1);
    for (const method of ["log", "warn", "error"] as const) expect(console[method]).not.toHaveBeenCalled();
  });
});