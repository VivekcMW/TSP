import { describe, expect, it } from "vitest";
import { render } from "./entry-server";
import type { PublicBillingPlan } from "@shared/public-billing";

const plan: PublicBillingPlan = {
  id: "live-plan", key: "live-plan", name: "Live catalogue plan", description: "Current plan",
  amount: 7311, currency: "USD", interval: "monthly", features: ["Current allowance"],
  recurringAvailable: false, available: true,
};

describe("request-time pricing renderer", () => {
  it("renders the actual catalogue and renewal terms without a loading shell", async () => {
    const html = await render("/pricing", { plans: [plan] });
    expect(html).toContain("$73.11");
    expect(html).toContain("Current allowance");
    expect(html).toContain("One-time access; no automatic renewal");
    expect(html).not.toContain("Loading current plans");
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it("does not reuse another request's plan data", async () => {
    const [first, second] = await Promise.all([
      render("/pricing", { plans: [plan] }),
      render("/pricing", { plans: [{ ...plan, amount: 9917, name: "Changed plan" }] }),
    ]);
    expect(first).toContain("$73.11");
    expect(first).not.toContain("$99.17");
    expect(second).toContain("$99.17");
    expect(second).not.toContain("$73.11");
  });

  it("escapes catalogue copy and does not offer unavailable checkout", async () => {
    const html = await render("/pricing", { plans: [{ ...plan, name: "<script>unsafe</script>", available: false }] });
    expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(html).not.toContain("<script>unsafe</script>");
    expect(html).toContain("Global checkout opens soon");
    expect(html).not.toContain("Choose &lt;script");
  });
});
