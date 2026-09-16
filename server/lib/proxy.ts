import { isIP } from "node:net";
import type { Express, RequestHandler } from "express";

// Never accept this header from the wire. Better Auth's Node adapter copies
// req.headers, not Express's req.ip or the socket's remoteAddress.
export const CLIENT_IP_HEADER = "x-tsp-client-ip";

export function trustedProxyAddresses(value = ""): string[] {
  if (!value.trim()) return [];
  const entries = value.split(",").map((entry) => entry.trim());
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split("/");
    const family = isIP(address);
    if (!family || extra !== undefined || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)))) {
      // Don't echo configuration values into logs (or accept aliases/hop counts).
      throw new Error("TRUSTED_PROXY_CIDRS must contain explicit IP addresses or non-zero CIDRs");
    }
  }
  return entries;
}

export const canonicalClientIp: RequestHandler = (req, res, next) => {
  delete req.headers[CLIENT_IP_HEADER];
  for (let i = req.rawHeaders.length - 2; i >= 0; i -= 2) {
    if (req.rawHeaders[i].toLowerCase() === CLIENT_IP_HEADER) req.rawHeaders.splice(i, 2);
  }

  // Express walks XFF right-to-left only while each sender is trusted. An
  // alternate direct origin route therefore cannot skip a fixed hop count.
  const resolved = req.ip;
  const socketIp = req.socket.remoteAddress;
  const ip = resolved && isIP(resolved) ? resolved : socketIp;
  if (!ip || !isIP(ip)) {
    res.status(503).json({ message: "Client address unavailable" });
    return;
  }
  req.headers[CLIENT_IP_HEADER] = ip;
  req.rawHeaders.push(CLIENT_IP_HEADER, ip);

  // better-call uses this header even with a static Better Auth baseURL.
  // req.protocol checks the immediate sender against Express's trust policy.
  const protocol = req.protocol;
  req.headers["x-forwarded-proto"] = protocol === "https" ? "https" : "http";
  next();
};

export function configureProxy(app: Express, value = process.env.TRUSTED_PROXY_CIDRS): void {
  const proxies = trustedProxyAddresses(value);
  app.set("trust proxy", proxies.length ? proxies : false);
  app.use(canonicalClientIp);
}