import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: vi.fn(), mode: "order" }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => [initial === "order" ? state.mode : initial, vi.fn()] }));
vi.mock("wouter", () => ({ Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: state.query, useQueryClient: () => ({ invalidateQueries: vi.fn() }), useMutation: () => ({ isPending: false, mutate: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn(() => { throw new Error("Network forbidden in rendered billing tests"); }) }));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/seo", () => ({ SEO: () => null }));
import { BillingPanel } from "./billing";
import Pricing from "./pricing";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
const plan = { id: "catalog-plan", name: "Actual catalog plan", amount: 7311, currency: "USD", interval: "monthly", features: ["Actual catalog feature"], recurringAvailable: true };
let data: any;
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-19T12:00:00Z"));
  state.mode = "order";
  data = { configured: true, plans: [plan], currentPlan: null, subscription: null, paymentMethods: [], payments: [] };
  state.query.mockImplementation(() => ({ data, isLoading: false, isPending: false, isError: false, refetch: vi.fn() }));
});
afterEach(() => vi.restoreAllMocks());
const render = () => renderToStaticMarkup(React.createElement(BillingPanel));
describe("rendered billing and public catalog (mocked, no browser/providers)", () => {
  it("renders catalog price/features and no fabricated Free fallback or renewal", () => {
    const html = render();
    expect(html).toContain("Actual catalog plan"); expect(html).toContain("$73.11"); expect(html).toContain("Actual catalog feature");
    expect(html).toContain("Unavailable"); expect(html).toContain("Buy one interval"); expect(html).not.toContain("Renews");
    expect(html).not.toContain("Cancel subscription");
  });
  it("does not offer cancellation for an order and labels its expiry honestly", () => {
    data.subscription = { status: "active", currentPeriodEnd: "2026-10-01", cancelAtPeriodEnd: false };
    const html = render(); expect(html).toContain("Access ends"); expect(html).not.toContain("Cancel subscription");
  });
  it("offers real recurring cancellation without promising pending access", () => {
    data.subscription = { status: "pending", razorpaySubscriptionId: "sub_1", currentPeriodEnd: "2026-10-01", cancelAtPeriodEnd: false };
    const html = render(); expect(html).toContain("Cancel subscription"); expect(html).toContain("requires provider confirmation");
    expect(html).not.toContain("Your access remains active");
  });
  it.each(["cancelled", "expired", "completed"].flatMap(status => [false, true].map(cancelAtPeriodEnd => ({ status, cancelAtPeriodEnd }))))("renders terminal $status without scheduled cancellation (flag $cancelAtPeriodEnd)", state => {
    data.subscription = { ...state, razorpaySubscriptionId: "sub_1", currentPeriodEnd: "2026-09-01" };
    const html = render();
    expect(html).toContain(`>${state.status}</p>`);
    expect(html).toContain("Period ended");
    expect(html).not.toMatch(/Cancellation scheduled|Current cycle ends|Access ends|Renews|Cancel subscription/);
  });
  it("does not claim a cancelled future period is still access", () => {
    data.subscription = { status: "cancelled", cancelAtPeriodEnd: true, razorpaySubscriptionId: "sub_1", currentPeriodEnd: "2026-10-01" };
    const html = render();
    expect(html).toContain(">cancelled</p>"); expect(html).toContain("Recorded period end");
    expect(html).not.toMatch(/Cancellation scheduled|Access ends|Renews/);
  });
  it("shows expiry even when the provider status is still active", () => {
    data.subscription = { status: "active", cancelAtPeriodEnd: true, razorpaySubscriptionId: "sub_1", currentPeriodEnd: "2026-09-01" };
    const html = render();
    expect(html).toContain(">expired</p>"); expect(html).toContain("Period ended");
    expect(html).not.toMatch(/Cancellation scheduled|Current cycle ends|Access ends|Renews/);
  });
  it("requires explicit cycles and disables recurring checkout when provider plan is missing", () => {
    state.mode = "subscription"; data.plans = [{ ...plan, recurringAvailable: false }];
    const html = render(); expect(html).toContain('id="billing-cycles"'); expect(html).toContain("1–100");
    expect(html).toContain("Recurring checkout is not configured for this plan");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start recurring checkout<\/button>/);
  });
  it("public pricing uses the live catalog contract, with no unlimited-free promotion", () => {
    const html = renderToStaticMarkup(React.createElement(Pricing));
    expect(state.query).toHaveBeenCalledWith({ queryKey: ["/api/public/billing/plans"] });
    expect(html).toContain("$73.11"); expect(html).toContain("Actual catalog feature");
    expect(html).not.toMatch(/grandfather|first 1,000|Unlimited.*free/i);
  });
  it("shows unavailable instead of speculative prices on catalog failure", () => {
    state.query.mockReturnValue({ isError: true, isPending: false, data: undefined });
    const html = renderToStaticMarkup(React.createElement(Pricing));
    expect(html).toContain("plan catalog is unavailable"); expect(html).not.toContain("$73.11");
  });
});