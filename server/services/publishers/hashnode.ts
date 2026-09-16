import { storage, type TenantScope } from "../../storage";
import { decryptStoredCredential } from "../webhookSecrets";

const HASHNODE_API = "https://gql.hashnode.com/";

function titleFrom(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").trim() || "The Social Pundit article";
  return firstLine.slice(0, 128);
}

/** Resolves the personal access token's own user id and default publication id, used both at connect time and before publishing. */
export async function resolveHashnodePublication(personalAccessToken: string): Promise<{ publicationId: string } | { error: string }> {
  try {
    const response = await fetch(HASHNODE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: personalAccessToken },
      body: JSON.stringify({
        query: `query Me { me { publications(first: 1) { edges { node { id } } } } }`,
      }),
    });
    const json = (await response.json().catch(() => ({}))) as {
      data?: { me?: { publications?: { edges?: Array<{ node?: { id?: string } }> } } };
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok || json.errors?.length) return { error: json.errors?.[0]?.message || `Hashnode lookup failed (${response.status})` };
    const publicationId = json.data?.me?.publications?.edges?.[0]?.node?.id;
    if (!publicationId) return { error: "No Hashnode publication found. Hashnode now requires your publication to be on a paid Pro plan for API access (queries and mutations) — upgrade in your blog dashboard under Billing, then try again." };
    return { publicationId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Hashnode lookup failed" };
  }
}

/**
 * Publish article to Hashnode. Requires the account to be connected via
 * /api/integrations/hashnode/personal-access-token (server/routes/integrations.ts).
 */
export async function publishToHashnode(scope: TenantScope, draftId: string, content: string) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, postId: `sandbox_hashnode_${Date.now()}` };
  const account = await storage.getSocialAccountByProvider(scope, "hashnode");
  if (!account?.accessToken || !account.providerAccountId) return { success: false, error: "Hashnode account is not connected" };
  try {
    const token = decryptStoredCredential(account.accessToken);
    const response = await fetch(HASHNODE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        query: `mutation PublishPost($input: PublishPostInput!) { publishPost(input: $input) { post { id slug url } } }`,
        variables: { input: { title: titleFrom(content), publicationId: account.providerAccountId, contentMarkdown: content } },
      }),
    });
    const json = (await response.json().catch(() => ({}))) as {
      data?: { publishPost?: { post?: { id?: string; url?: string } } };
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok || json.errors?.length) return { success: false, error: json.errors?.[0]?.message || `Hashnode publish failed (${response.status})` };
    const post = json.data?.publishPost?.post;
    if (!post?.id) return { success: false, error: "Hashnode did not return a post ID" };
    return { success: true, postId: post.id, postUrl: post.url };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Hashnode publish failed" };
  }
}
