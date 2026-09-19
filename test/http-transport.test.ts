import { Agent, createServer, globalAgent, type ClientRequest, type RequestListener, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { installSupertestTransport } from "./supertest-transport";

// Real loopback HTTP only: no application imports, DB, env files or providers.
// Superagent's agent:false creates a fresh non-keep-alive Node agent even when
// globalAgent.keepAlive is true. Keep this contract executable before attributing
// wrong-status/HTTP-parser failures to cross-fixture global socket pooling.
function transport(test: request.Test) {
  return test as request.Test & { req: ClientRequest & { agent: Agent }; app: Server };
}

async function listen(server: Server, port = 0) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

describe("Supertest transport isolation", () => {
  it.skipIf(process.platform !== "darwin")("does not reach an unrelated IPv4 listener when a wildcard fixture is assigned its port", async () => {
    let decoyHits = 0;
    let fixtureHits = 0;
    const decoy = createServer((_req, res) => {
      decoyHits++;
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ server: "unrelated IPv4 listener" }));
    });
    const fixture = createServer((_req, res) => {
      fixtureHits++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ server: "intended fixture" }));
    });
    try {
      const port = await listen(decoy);
      const originalListen = fixture.listen;
      // Make macOS's ephemeral-port choice deterministic. The original Supertest
      // listen(0) binds :: on this occupied IPv4 port, then requests 127.0.0.1.
      // Explicit IPv4 binding must keep its own free-port selection instead.
      fixture.listen = function (this: Server, ...args: unknown[]) {
        if (args[0] === 0 && args[1] === undefined) args[0] = port;
        return Reflect.apply(originalListen, this, args);
      } as typeof fixture.listen;
      const response = await request(fixture).get("/target").timeout(2000);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toEqual({ server: "intended fixture" });
      expect(fixtureHits).toBe(1);
      expect(decoyHits).toBe(0);
    } finally {
      await close(fixture);
      await close(decoy);
    }
  });

  it.each(["request", "cookie agent"] as const)("isolates ephemeral fixtures with %s", async mode => {
    const agents = new Set<Agent>();
    const sockets = new Set<Socket>();
    const statuses = [200, 400, 401, 404, 500];
    for (let index = 0; index < 256; index++) {
      const status = statuses[index % statuses.length];
      const received: Array<{ url: string | undefined; connection: string | undefined; localAddress: string | undefined }> = [];
      const handler: RequestListener = (req, res) => {
        sockets.add(req.socket);
        received.push({ url: req.url, connection: req.headers.connection, localAddress: req.socket.localAddress });
        res.writeHead(status, { "content-type": "application/json", "x-fixture-id": String(index) });
        res.end(JSON.stringify({ fixture: index }));
      };
      const client = mode === "request" ? request(handler) : request.agent(handler);
      const test = transport(client.get(`/fixture/${index}`).timeout(2000));
      try {
        const response = await test;
        const diagnostic = JSON.stringify({ mode, index, url: test.url, status: response.status,
          body: response.body, text: response.text, headers: response.headers, received,
          reusedSocket: test.req.reusedSocket, globalAgent: test.req.agent === globalAgent });
        expect(response.status, diagnostic).toBe(status);
        expect(response.body, diagnostic).toEqual({ fixture: index });
        expect(received).toEqual([{ url: `/fixture/${index}`, connection: "close", localAddress: "127.0.0.1" }]);
        expect(test.req.agent).not.toBe(globalAgent);
        expect(test.req.agent).toHaveProperty("keepAlive", false);
        expect(test.req.reusedSocket).toBe(false);
        expect(agents.has(test.req.agent)).toBe(false);
        agents.add(test.req.agent);
        // Supertest must finish closing its owned listener before resolving.
        expect(test.app.listening).toBe(false);
      } finally {
        test.req?.destroy();
        await close(test.app);
      }
    }
    expect(agents.size).toBe(256);
    expect(sockets.size).toBe(256);
  });

  it("does not mix responses when successive servers reuse exactly the same port", async () => {
    let port = 0;
    const sockets = new Set<Socket>();
    for (let index = 0; index < 100; index++) {
      const status = [401, 404, 500, 400, 200][index % 5];
      const server = createServer((req, res) => {
        sockets.add(req.socket);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ fixture: index, url: req.url }));
      });
      try {
        const boundPort = await listen(server, port);
        if (port) expect(boundPort).toBe(port);
        port = boundPort;
        const test = transport(request(server).get(`/fixture/${index}`).timeout(2000));
        const response = await test;
        expect(response.status, `fixture ${index} on port ${port}`).toBe(status);
        expect(response.body).toEqual({ fixture: index, url: `/fixture/${index}` });
        expect(test.req.reusedSocket).toBe(false);
        // Already-listening servers remain owned by the fixture, not Supertest.
        expect(server.listening).toBe(true);
      } finally {
        await close(server);
      }
    }
    expect(sockets.size).toBe(100);
  });

  it("preserves cookie sessions without reusing transport sockets", async () => {
    const sockets = new Set<Socket>();
    const server = createServer((req, res) => {
      sockets.add(req.socket);
      if (req.url === "/login") {
        res.setHeader("set-cookie", "session=fixture-only; Path=/; HttpOnly");
        res.end("logged in");
      } else {
        res.statusCode = req.headers.cookie === "session=fixture-only" ? 200 : 401;
        res.end("session check");
      }
    });
    try {
      const client = request.agent(server);
      await client.get("/login").timeout(2000).expect(200);
      await client.get("/private").timeout(2000).expect(200);
      await request(server).get("/private").timeout(2000).expect(401);
      expect(sockets.size).toBe(3);
    } finally {
      await close(server);
    }
  });

  it("preserves callback requests, JSON bodies, query strings and real TCP peers", async () => {
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ body: JSON.parse(body), url: req.url, peer: req.socket.remoteAddress }));
      });
    });
    let calls = 0;
    try {
      const response = await new Promise<request.Response>((resolve, reject) => {
        request(server).post("/echo").query({ edition: "en-IN" }).send({ focus: "boundary" })
          .timeout(2000).expect(200).end((error, result) => {
            calls++;
            if (error) reject(error);
            else resolve(result);
          });
      });
      expect(response.body).toEqual({ body: { focus: "boundary" }, url: "/echo?edition=en-IN", peer: "127.0.0.1" });
      expect(calls).toBe(1);
      expect(server.listening).toBe(false);
    } finally {
      await close(server);
    }
  });

  it("preserves relative redirects on the owned server", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/from") {
        res.writeHead(302, { location: "/to?source=redirect" });
        res.end();
      } else {
        res.end(req.url);
      }
    });
    try {
      const response = await request(server).get("/from").redirects(1).timeout(2000).expect(200);
      expect(response.text).toBe("/to?source=redirect");
      expect(server.listening).toBe(false);
    } finally {
      await close(server);
    }
  });

  it("propagates bind failures rather than sending to a placeholder port", async () => {
    const server = createServer();
    server.listen = (() => { throw new Error("synthetic bind failure"); }) as typeof server.listen;
    await expect(request(server).get("/").timeout(2000)).rejects.toThrow("synthetic bind failure");
    expect(server.listening).toBe(false);
  });

  it("tears down unsent fixtures and restores the previous transport hooks", async () => {
    const originalAddress = request.Test.prototype.serverAddress;
    const originalEnd = request.Test.prototype.end;
    const teardown = installSupertestTransport();
    const server = createServer();
    try {
      request(server).get("/never-sent");
    } finally {
      await teardown();
    }
    expect(server.listening).toBe(false);
    expect(request.Test.prototype.serverAddress).toBe(originalAddress);
    expect(request.Test.prototype.end).toBe(originalEnd);
  });
});