/** Child-process fixture only. Never imported by server/index.ts. */
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { Agent, createServer } from "node:http";
import net from "node:net";
import { gzipSync } from "node:zlib";
import nodeFetch from "node-fetch";
import { fetchPublicText } from "../crawlerFetch";
import { fetchArticleFromUrl } from "../urlFetcher";
import { discoverFeed } from "../feedDiscovery";

async function main() {
  assert.equal(typeof nodeFetch, "function", "node-fetch default export must be callable");
  const paragraph = "A reported trial describes its methods and concrete findings, including the limitations of this study.";
  let requests = 0;
  let connections = 0;
  const server = createServer((req, res) => {
    requests++;
    assert.equal(req.headers.host, "public-fixture.test");
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    if (req.url === "/redirect") { res.writeHead(302, { location: "/article" }); res.end(); return; }
    if (req.url === "/private-redirect") { res.writeHead(302, { location: "http://127.0.0.1/secret" }); res.end(); return; }
    if (req.url === "/denied") { res.writeHead(403); res.end(); return; }
    if (req.url === "/large") {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(gzipSync("x".repeat(4096))); return;
    }
    if (req.url === "/feed") {
      res.writeHead(200, { "content-type": "application/feed+json" });
      res.end(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ title: "Trial", url: "http://public-fixture.test/article", content_text: paragraph }] })); return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url === "/login" ? "<html><main>Log in to continue</main></html>" : `<html><title>Trial</title><article><p>${paragraph}</p></article></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const originalLookup = dns.lookup;
  const originalConnect = Agent.prototype.createConnection;
  try {
    // Simulate public DNS, then redirect ONLY the socket boundary to the local
    // fixture. The compiled validator still rejects private targets and the
    // actual node-fetch default export sends/reads real HTTP bytes. No bypass
    // option or test hostname is added to application code.
    dns.lookup = (async (hostname: string) => {
      assert.equal(hostname, "public-fixture.test");
      return [{ address: "93.184.216.34", family: 4 }];
    }) as unknown as typeof dns.lookup;
    Agent.prototype.createConnection = function (options: net.NetConnectOpts) {
      connections++;
      const pinned = options as net.TcpNetConnectOpts;
      assert.equal(pinned.host, "public-fixture.test");
      assert(pinned.lookup);
      pinned.lookup("public-fixture.test", {}, (error, ip, family) => {
        assert.equal(error, null);
        assert.equal(ip, "93.184.216.34");
        assert.equal(family, 4);
      });
      return net.connect({ host: "127.0.0.1", port: address.port });
    };

    const article = await fetchArticleFromUrl("http://public-fixture.test/redirect");
    assert.equal(article.url, "http://public-fixture.test/article");
    assert.equal(article.content, paragraph);
    assert.equal(article.contentMetadata?.extractionMethod, "article");
    assert.equal(requests, 2);
    assert.equal(connections, 2);
    assert.deepEqual(await discoverFeed("http://public-fixture.test/feed"), { name: "public-fixture.test", feedUrl: "http://public-fixture.test/feed", sourceType: "feed" });
    await assert.rejects(fetchArticleFromUrl("http://public-fixture.test/login"), { code: "quality" });
    await assert.rejects(fetchPublicText("http://public-fixture.test/denied"), { code: "http" });
    await assert.rejects(fetchPublicText("http://public-fixture.test/large", { maxBytes: 1000 }), { code: "size" });
    const before = requests;
    await assert.rejects(fetchPublicText("http://127.0.0.1/secret"), { code: "blocked" });
    assert.equal(requests, before);
    await assert.rejects(fetchPublicText("http://public-fixture.test/private-redirect"), { code: "blocked" });
    assert.equal(requests, before + 1);
    console.log("compiled crawler transport smoke passed");
  } finally {
    dns.lookup = originalLookup;
    Agent.prototype.createConnection = originalConnect;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });