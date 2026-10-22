import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { sitemapEntries } from "../server/public-seo";

/**
 * IndexNow (https://www.indexnow.org) tells Bing, Yandex, Seznam, Naver and other participating
 * search engines that pages changed, so they recrawl in minutes instead of days. The key is
 * public by design: search engines verify it by fetching https://www.thesocialpundit.com/<key>.txt,
 * served from client/public. Changing the key means renaming that file too.
 */
export const INDEXNOW_KEY = "8bde2aec09c17c43d98beae45dd6b984";
const HOST = "www.thesocialpundit.com";
const ENDPOINT = "https://api.indexnow.org/indexnow";

export function indexNowPayload(urls = sitemapEntries().map(entry => entry.loc)) {
  return { host: HOST, key: INDEXNOW_KEY, keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`, urlList: urls };
}

export async function submitToIndexNow(fetchImpl: typeof fetch = fetch) {
  const payload = indexNowPayload();
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  // 200 OK and 202 Accepted both mean the submission was received.
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow rejected the submission: HTTP ${response.status} ${await response.text().catch(() => "")}`.trim());
  }
  return { status: response.status, submitted: payload.urlList.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  submitToIndexNow()
    .then(result => console.log(`IndexNow accepted ${result.submitted} URLs (HTTP ${result.status})`))
    .catch(error => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
