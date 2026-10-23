import { storage, type TenantScope } from "../../storage";
import { decryptStoredCredential } from "../webhookSecrets";

const GRAPH_THREADS = "https://graph.threads.net/v1.0";

/**
 * Publish a text-only Thread via the official two-step container/publish flow.
 * Threads' image/video container requires a publicly fetchable URL (it curls
 * the file itself); this app's media is stored privately, so attachments are
 * not supported yet. Text-only matches the app's declared maxMedia of 0.
 */
export async function publishToThreads(scope: TenantScope, _draftId: string, content: string) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, status: "simulated" };
  const account = await storage.getSocialAccountByProvider(scope, "threads");
  if (!account?.accessToken || !account.providerAccountId) return { success: false, error: "Connect Threads before publishing" };
  try {
    const accessToken = decryptStoredCredential(account.accessToken);
    const userId = account.providerAccountId;
    const containerParams = new URLSearchParams({ media_type: "TEXT", text: content.slice(0, 500), access_token: accessToken });
    const containerResponse = await fetch(`${GRAPH_THREADS}/${userId}/threads`, { method: "POST", body: containerParams });
    const container = await containerResponse.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
    if (!containerResponse.ok || !container.id) return { success: false, error: container.error?.message || `Threads publish failed (${containerResponse.status})` };

    const publishParams = new URLSearchParams({ creation_id: container.id, access_token: accessToken });
    const publishResponse = await fetch(`${GRAPH_THREADS}/${userId}/threads_publish`, { method: "POST", body: publishParams });
    const published = await publishResponse.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
    if (!publishResponse.ok || !published.id) return { success: false, error: published.error?.message || `Threads publish failed (${publishResponse.status})` };
    return { success: true, postId: published.id };
  } catch {
    return { success: false, error: "Threads delivery could not be confirmed" };
  }
}
