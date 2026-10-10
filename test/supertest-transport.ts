import { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";

function bindLoopback(server: Server) {
  return new Promise<AddressInfo>((resolve, reject) => {
    const failed = (error: Error) => {
      server.off("error", failed);
      server.off("listening", listening);
      reject(error);
    };
    const listening = () => {
      server.off("error", failed);
      resolve(server.address() as AddressInfo);
    };
    server.once("error", failed);
    server.once("listening", listening);
    try { server.listen(0, "127.0.0.1"); }
    catch (error) { failed(error as Error); }
  });
}

async function closeBinding([server, ready]: [Server, Promise<AddressInfo>]) {
  await ready.catch(() => {});
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

/**
 * Test-only fix for macOS wildcard/IPv4 port collisions. Supertest 7.2 binds
 * listen(0) (usually ::) but sends to 127.0.0.1. macOS can assign that wildcard
 * listener a port already served by an unrelated IPv4 listener, so the client
 * reaches the wrong app. Agent pooling is not involved (Superagent uses false).
 *
 * Bind the SAME address we request. Explicit-host listen is asynchronous, so
 * defer end() until listening rather than reading address().port immediately.
 * Keep real TCP peer addresses, request bodies, cookies and security gates.
 * Already-listening servers, URL targets, HTTPS and HTTP/2 are left unchanged.
 */
export function installSupertestTransport() {
  const prototype = request.Test.prototype;
  const originalAddress = prototype.serverAddress;
  const originalEnd = prototype.end;
  const bindings = new Map<Server, Promise<AddressInfo>>();
  const pending = new WeakMap<request.Test, Promise<AddressInfo>>();

  prototype.serverAddress = function (app, path) {
    if (!(app instanceof Server) || app.address()) {
      return originalAddress.call(this, app, path);
    }
    let ready = bindings.get(app);
    if (ready === undefined) {
      ready = bindLoopback(app);
      // A Test may be constructed before its .end()/then() is attached.
      void ready.catch(() => {});
      bindings.set(app, ready);
      app.once("close", () => bindings.delete(app));
      // Preserve Supertest's ownership/close-before-assert lifecycle.
      (this as request.Test & { _server: Server })._server = app;
    }
    pending.set(this, ready);
    return `http://127.0.0.1:0${path}`;
  };

  prototype.end = function (callback) {
    const ready = pending.get(this);
    if (ready === undefined) return originalEnd.call(this, callback);
    pending.delete(this);
    void ready.then(address => {
      this.url = this.url.replace("http://127.0.0.1:0", `http://127.0.0.1:${address.port}`);
      originalEnd.call(this, callback);
    }).catch(error => {
      // Node/Superagent callbacks pass no response on a connection failure.
      if (callback) Reflect.apply(callback, this, [error]);
      else this.emit("error", error);
    });
    return this;
  };

  return async () => {
    prototype.serverAddress = originalAddress;
    prototype.end = originalEnd;
    // Normal awaited requests have already closed themselves. Also clean up a
    // constructed-but-unsent fixture after a failed test, without leaking ports.
    await Promise.all([...bindings].map(closeBinding));
    bindings.clear();
  };
}