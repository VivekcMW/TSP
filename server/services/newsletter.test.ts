import { describe, expect, it } from "vitest";
import { newsletterToken, tokenMatches } from "./newsletter";

const secret = Buffer.from("newsletter-test-secret-that-is-long-enough");

describe("newsletter links", () => {
  it("accept only the link made for that subscriber, purpose and current nonce", () => {
    const token = newsletterToken("confirm", "sub-1", "nonce-a", secret);
    expect(token.startsWith("sub-1.")).toBe(true);
    expect(tokenMatches("confirm", token, "sub-1", "nonce-a", secret)).toBe(true);
    expect(tokenMatches("unsubscribe", token, "sub-1", "nonce-a", secret)).toBe(false);
    expect(tokenMatches("confirm", token, "sub-1", "nonce-b", secret)).toBe(false);
    expect(tokenMatches("confirm", token, "sub-2", "nonce-a", secret)).toBe(false);
    expect(tokenMatches("confirm", token.slice(0, -2) + "xx", "sub-1", "nonce-a", secret)).toBe(false);
    expect(tokenMatches("confirm", token, "sub-1", "nonce-a", Buffer.from("another-secret-another-secret-12345"))).toBe(false);
  });
});
