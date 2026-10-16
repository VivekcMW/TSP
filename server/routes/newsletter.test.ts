import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardNotificationsMediaNetwork } from "../../test/notifications-media-network";

const m = vi.hoisted(() => ({ request: vi.fn(), sent: vi.fn(), confirm: vi.fn(), unsubscribe: vi.fn(), deliver: vi.fn() }));
vi.mock("../services/newsletter", () => ({
  requestSubscription: m.request, markConfirmationSent: m.sent, confirmSubscription: m.confirm, unsubscribe: m.unsubscribe,
  confirmUrl: (id: string, nonce: string) => `https://app.test/newsletter?confirm=${id}.${nonce}`,
}));
vi.mock("../services/email", async () => ({ deliverAppEmail: m.deliver, emailTemplates: (await import("../services/email/templates")).emailTemplates }));
vi.mock("../middlewares/rateLimit", () => ({ newsletterSignupRateLimit: (_req: unknown, _res: unknown, next: () => void) => next() }));
import { registerNewsletterRoutes } from "./newsletter";

guardNotificationsMediaNetwork();
const app = express();
app.use(express.json());
registerNewsletterRoutes(app);
const GENERIC = { message: "Check your inbox and click the link to confirm your subscription." };
beforeEach(() => { vi.clearAllMocks(); m.deliver.mockResolvedValue({ messageId: "m" }); });

describe("newsletter sign-up", () => {
  it("rejects an address that isn't an email, without storing anything", async () => {
    await request(app).post("/api/public/newsletter").send({ email: "not-an-email" }).expect(400);
    await request(app).post("/api/public/newsletter").send({ email: "a@b.test", extra: true }).expect(400);
    expect(m.request).not.toHaveBeenCalled();
  });

  it("emails a confirmation link for a new sign-up and records that it was sent", async () => {
    m.request.mockResolvedValue({ id: "sub-1", nonce: "n1", send: true });
    const response = await request(app).post("/api/public/newsletter").send({ email: " Ana@Example.test " }).expect(202);
    expect(response.body).toEqual(GENERIC);
    expect(m.request).toHaveBeenCalledWith("ana@example.test", "landing");
    expect(m.deliver).toHaveBeenCalledWith(expect.objectContaining({
      type: "newsletter_confirmation", recipient: "ana@example.test", required: true, dedupeKey: "newsletter-confirm:sub-1:n1",
      primaryCta: { label: "Confirm subscription", url: "https://app.test/newsletter?confirm=sub-1.n1" },
    }));
    expect(m.sent).toHaveBeenCalledWith("sub-1");
  });

  it("answers exactly the same way when no email is due, so nobody can tell who is subscribed", async () => {
    m.request.mockResolvedValue({ id: "sub-2", nonce: "n2", send: false });
    const response = await request(app).post("/api/public/newsletter").send({ email: "bo@example.test" }).expect(202);
    expect(response.body).toEqual(GENERIC);
    expect(m.deliver).not.toHaveBeenCalled();
  });

  it("reports a temporary failure without details", async () => {
    m.request.mockRejectedValue(new Error("private database detail"));
    const response = await request(app).post("/api/public/newsletter").send({ email: "cy@example.test" }).expect(503);
    expect(JSON.stringify(response.body)).not.toContain("private");
  });

  it.each([
    ["confirm", "confirmed", 200], ["confirm", "invalid", 400],
    ["unsubscribe", "unsubscribed", 200], ["unsubscribe", "invalid", 400],
  ] as const)("%s → %s", async (action, outcome, status) => {
    (action === "confirm" ? m.confirm : m.unsubscribe).mockResolvedValue(outcome);
    const response = await request(app).post(`/api/public/newsletter/${action}`).send({ token: "sub-1.signature" }).expect(status);
    expect(response.body.status ?? "invalid").toBe(outcome === "invalid" ? "invalid" : outcome);
  });
});
