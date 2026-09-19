import { storage, type TenantScope } from "../../storage";
import { decryptStoredCredential } from "../webhookSecrets";

export async function publishToReddit(scope: TenantScope, draftId: string, content: string) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, status: "simulated" };
  const account = await storage.getSocialAccountByProvider(scope, "reddit");
  if (!account?.accessToken || !account.accountHandle) return { success: false, error: "Connect Reddit and choose a subreddit before publishing" };
  const title = content.split("\n").find(Boolean)?.replace(/^#+\s*/, "").slice(0, 300) || "The Social Pundit post";
  try {
    const response = await fetch("https://oauth.reddit.com/api/submit", { method: "POST", headers: { Authorization: `Bearer ${decryptStoredCredential(account.accessToken)}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "TheSocialPundit/1.0" }, body: new URLSearchParams({ sr: account.accountHandle, kind: "self", title, text: content, api_type: "json", send_replies: "true" }) });
    const json = await response.json() as { json?: { data?: { name?: string; url?: string }; errors?: string[][] } };
    const error = json.json?.errors?.[0]?.[1];
    if (!response.ok || error) return { success: false, error: error || `Reddit publish failed (${response.status})` };
    const data = json.json?.data; if (!data?.name) return { success: false, error: "Reddit did not return a post ID" };
    return { success: true, postId: data.name, postUrl: data.url ? `https://reddit.com${data.url}` : undefined };
  } catch { return { success: false, error: "Reddit delivery could not be confirmed" }; }
}
