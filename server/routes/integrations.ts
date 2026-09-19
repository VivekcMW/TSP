import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { platformIntegrations } from "@shared/schema";
import { publishingCapability } from "@shared/publishing-capabilities";
import { toSafeSocialAccount } from "../lib/sanitize";
import { storage } from "../storage";
import { PROVIDER_CATALOG, resolveProviderDefinition, runProviderSandbox } from "../services/publishers/providerSandbox";
import { assessProviderConnection } from "../services/publishers/providerLifecycle";
import { refreshProviderAccessToken, validateProviderRuntimeConfig } from "../services/publishers/providerAuth";
import { resolveHashnodePublication } from "../services/publishers/hashnode";
import { verifyMastodonAccessToken } from "../services/publishers/mastodon";
import { publicHttpsInstanceOrigin } from "../services/safeOutbound";
import { verifyBlueskyAppPassword } from "../services/publishers/bluesky";
import { verifyDevToApiKey } from "../services/publishers/devto";
import { verifyTelegramBot } from "../services/publishers/telegram";
import { isValidWebhookUrl, verifyWebhook, WEBHOOK_PROVIDERS, type WebhookProvider } from "../services/webhookPublisher";

const providerSandboxSchema = z.object({
  provider: z.string().min(1),
  mode: z.enum(["sandbox", "dry-run", "live"]).optional(),
  content: z.string().min(1),
  metadata: z.record(z.any()).optional(),
});

const providerConnectionSchema = z.object({
  accessToken: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  scopes: z.array(z.string()).optional(),
  tokenExpiresAt: z.coerce.date().optional(),
  accountName: z.string().optional(),
  accountHandle: z.string().optional(),
  providerAccountId: z.string().optional(),
  profileImageUrl: z.string().optional(),
  isActive: z.boolean().optional(),
});
const webhookSchema = z.object({ webhookUrl: z.string().url() });
const rawCredential = (min: number, max: number) => z.string().trim().min(min).max(max).refine(value => !value.startsWith("enc:"));
const devToKeySchema = z.object({ apiKey: rawCredential(20, 256) });
const hashnodeTokenSchema = z.object({ personalAccessToken: rawCredential(20, 256) });
const blueskyConnectionSchema = z.object({ handle: z.string().trim().min(3).max(253), appPassword: rawCredential(8, 128) });
const mastodonConnectionSchema = z.object({ instanceUrl: z.string().url().max(253), accessToken: rawCredential(20, 512) });
const telegramConnectionSchema = z.object({ botToken: rawCredential(20, 256), chatId: z.string().trim().min(1).max(64) });

function normalizeProviderKey(provider: string): string {
  const resolved = resolveProviderDefinition(provider);
  return resolved?.key ?? provider.trim().toLowerCase();
}

/**
 * Read-only, any-signed-in-user view of platform-wide integration
 * availability — the tenant app uses this to grey out a platform an admin
 * has turned off globally, separate from the admin CRUD in routes/admin.ts.
 */
export function registerIntegrationsRoutes(app: Express) {
  app.post("/api/integrations/mastodon/access-token", requireDbUser, requirePermission("social:connect:own"), async (req, res) => {
    const validation = mastodonConnectionSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Enter a valid Mastodon instance URL and access token" });
    let instanceUrl: string;
    try { instanceUrl = publicHttpsInstanceOrigin(validation.data.instanceUrl); }
    catch { return res.status(400).json({ message: "Mastodon instances must use a public HTTPS hostname" }); }
    const parsedUrl = new URL(instanceUrl);
    try {
      const verified = await verifyMastodonAccessToken(instanceUrl, validation.data.accessToken);
      if ("error" in verified) return res.status(400).json({ message: "Could not verify Mastodon credentials" });
      const scope = authedOf(req).tenant;
      const existing = await storage.getSocialAccountByProvider(scope, "mastodon");
      const data = { provider: "mastodon", providerAccountId: instanceUrl, accountName: parsedUrl.hostname, accountHandle: parsedUrl.hostname, accessToken: validation.data.accessToken, scopes: [], isActive: true };
      const connection = existing ? await storage.updateSocialAccount(scope, existing.id, data) : await storage.createSocialAccount(scope, data);
      res.status(201).json({ success: true, instance: connection ? toSafeSocialAccount(connection) : null });
    } catch {
      console.error("Mastodon connection failed");
      res.status(500).json({ message: "Could not store Mastodon connection" });
    }
  });
  app.post("/api/integrations/bluesky/app-password", requireDbUser, requirePermission("social:connect:own"), async (req, res) => {
    const validation = blueskyConnectionSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Enter a valid Bluesky handle and app password" });
    try {
      const verified = await verifyBlueskyAppPassword(validation.data.handle, validation.data.appPassword);
      if ("error" in verified) return res.status(400).json({ message: "Could not verify Bluesky credentials" });
      const scope = authedOf(req).tenant;
      const existing = await storage.getSocialAccountByProvider(scope, "bluesky");
      const data = { provider: "bluesky", providerAccountId: validation.data.handle, accountName: validation.data.handle, accountHandle: `@${validation.data.handle}`, accessToken: validation.data.appPassword, scopes: [], isActive: true };
      const connection = existing ? await storage.updateSocialAccount(scope, existing.id, data) : await storage.createSocialAccount(scope, data);
      res.status(201).json({ success: true, instance: connection ? toSafeSocialAccount(connection) : null });
    } catch {
      console.error("Bluesky connection failed");
      res.status(500).json({ message: "Could not store Bluesky connection" });
    }
  });
  app.post("/api/integrations/telegram/bot-token", requireDbUser, requirePermission("social:connect:own"), async (req, res) => {
    const validation = telegramConnectionSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Enter a valid Telegram bot token and chat ID" });
    try {
      const verified = await verifyTelegramBot(validation.data.botToken, validation.data.chatId);
      if ("error" in verified) return res.status(400).json({ message: "Could not verify Telegram credentials and chat access" });
      const scope = authedOf(req).tenant;
      const existing = await storage.getSocialAccountByProvider(scope, "telegram");
      const data = { provider: "telegram", providerAccountId: validation.data.chatId, accountName: verified.chatTitle, accountHandle: verified.chatTitle, accessToken: validation.data.botToken, scopes: [], isActive: true };
      const connection = existing ? await storage.updateSocialAccount(scope, existing.id, data) : await storage.createSocialAccount(scope, data);
      res.status(201).json({ success: true, instance: connection ? toSafeSocialAccount(connection) : null });
    } catch {
      console.error("Telegram connection failed");
      res.status(500).json({ message: "Could not store Telegram connection" });
    }
  });
  app.post("/api/integrations/devto/api-key", requireDbUser, requirePermission("social:connect:own"), async (req, res) => {
    const validation = devToKeySchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Invalid Dev.to API key" });
    try {
      const verified = await verifyDevToApiKey(validation.data.apiKey);
      if ("error" in verified) return res.status(400).json({ message: "Could not verify Dev.to credentials" });
      const scope = authedOf(req).tenant;
      const existing = await storage.getSocialAccountByProvider(scope, "devto");
      const data = { provider: "devto", providerAccountId: "devto", accountName: "Dev.to", accessToken: validation.data.apiKey, scopes: ["articles:write"], isActive: true };
      const connection = existing ? await storage.updateSocialAccount(scope, existing.id, data) : await storage.createSocialAccount(scope, data);
      res.status(201).json({ success: true, instance: connection ? toSafeSocialAccount(connection) : null });
    } catch {
      console.error("Dev.to API key connection failed");
      res.status(500).json({ message: "Could not store Dev.to API key" });
    }
  });
  app.post("/api/integrations/hashnode/personal-access-token", requireDbUser, requirePermission("social:connect:own"), async (req, res) => {
    const validation = hashnodeTokenSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Invalid Hashnode personal access token" });
    try {
      const scope = authedOf(req).tenant;
      const resolved = await resolveHashnodePublication(validation.data.personalAccessToken);
      if ("error" in resolved) return res.status(400).json({ message: "Could not verify Hashnode credentials and publication access" });
      const existing = await storage.getSocialAccountByProvider(scope, "hashnode");
      const data = { provider: "hashnode", providerAccountId: resolved.publicationId, accountName: "Hashnode", accessToken: validation.data.personalAccessToken, scopes: ["post:write"], isActive: true };
      const connection = existing ? await storage.updateSocialAccount(scope, existing.id, data) : await storage.createSocialAccount(scope, data);
      res.status(201).json({ success: true, instance: connection ? toSafeSocialAccount(connection) : null });
    } catch {
      console.error("Hashnode connection failed");
      res.status(500).json({ message: "Could not store Hashnode personal access token" });
    }
  });
  app.post("/api/integrations/:provider/webhook", requireDbUser, requirePermission("social:connect:own"), async (req, res) => {
    const provider = req.params.provider as WebhookProvider;
    const validation = webhookSchema.safeParse(req.body);
    if (!WEBHOOK_PROVIDERS.includes(provider) || !validation.success || !isValidWebhookUrl(provider, validation.data.webhookUrl)) return res.status(400).json({ message: "Invalid webhook URL" });
    try {
      const scope = authedOf(req).tenant;
      await verifyWebhook(provider, validation.data.webhookUrl);
      const existing = await storage.getSocialAccountByProvider(scope, provider);
      const data = { provider, providerAccountId: `webhook_${Date.now()}`, accountName: `${provider} webhook`, accessToken: validation.data.webhookUrl, scopes: [], isActive: true };
      const connection = existing ? await storage.updateSocialAccount(scope, existing.id, data) : await storage.createSocialAccount(scope, data);
      res.status(201).json({ success: true, instance: connection ? toSafeSocialAccount(connection) : null });
    } catch {
      console.error("Webhook connection failed");
      res.status(400).json({ message: "Could not verify and store webhook connection" });
    }
  });
  app.get("/api/integrations", requireDbUser, async (_req, res) => {
    try {
      const rows = await db
        .select({
          key: platformIntegrations.key,
          label: platformIntegrations.label,
          enabled: platformIntegrations.enabled,
        })
        .from(platformIntegrations);

      const catalog = PROVIDER_CATALOG.map((provider) => ({
        key: provider.key,
        label: provider.label,
        enabled: rows.find((row) => row.key === provider.key)?.enabled === true,
        authType: provider.authType,
        requiredScopes: provider.requiredScopes,
        capabilities: provider.capabilities,
        category: provider.category,
        publishing: publishingCapability(provider.key),
      }));

      res.json(catalog);
    } catch {
      console.error("Error listing integrations");
      res.status(500).json({ message: "Failed to list integrations" });
    }
  });

  app.get("/api/integrations/:provider/status", requireDbUser, async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const provider = normalizeProviderKey(req.params.provider);
      const definition = resolveProviderDefinition(provider);
      if (!definition) {
        return res.status(400).json({ message: `Provider ${provider} is not supported` });
      }

      const connection = await storage.getSocialAccountByProvider(scope, provider);
      const assessment = assessProviderConnection(provider, connection ?? null);

      return res.json({
        provider: definition.key,
        connected: Boolean(connection && connection.isActive),
        instance: connection ? toSafeSocialAccount(connection) : null,
        assessment,
      });
    } catch {
      console.error("Error fetching integration status");
      return res.status(500).json({ message: "Failed to fetch integration status" });
    }
  });

  app.post("/api/integrations/:provider/validate", requireDbUser, async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const provider = normalizeProviderKey(req.params.provider);
      const definition = resolveProviderDefinition(provider);
      if (!definition) {
        return res.status(400).json({ message: `Provider ${provider} is not supported` });
      }

      const existing = await storage.getSocialAccountByProvider(scope, provider);
      const payload = providerConnectionSchema.safeParse(req.body);
      const connection = {
        provider,
        isActive: existing?.isActive ?? true,
        accessToken: payload.success ? payload.data.accessToken ?? existing?.accessToken ?? null : existing?.accessToken ?? null,
        refreshToken: payload.success ? payload.data.refreshToken ?? existing?.refreshToken ?? null : existing?.refreshToken ?? null,
        scopes: payload.success ? payload.data.scopes ?? existing?.scopes ?? [] : existing?.scopes ?? [],
        tokenExpiresAt: payload.success && payload.data.tokenExpiresAt
          ? new Date(payload.data.tokenExpiresAt)
          : existing?.tokenExpiresAt ?? null,
      };

      const runtimeConfig = validateProviderRuntimeConfig(provider);
      const assessment = assessProviderConnection(provider, connection);

      return res.json({
        provider: definition.key,
        runtimeConfig,
        assessment,
        valid: assessment.canPublish && runtimeConfig.enabled,
      });
    } catch {
      console.error("Error validating integration");
      return res.status(500).json({ message: "Failed to validate integration" });
    }
  });

  app.post("/api/integrations/:provider/refresh", requireDbUser, requirePermission("social:connect:own"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { tenant: scope } = authedOf(req);
      const provider = normalizeProviderKey(req.params.provider);
      const definition = resolveProviderDefinition(provider);
      if (!definition) {
        return res.status(400).json({ message: `Provider ${provider} is not supported` });
      }

      const existing = await storage.getSocialAccountByProvider(scope, provider);
      if (!existing) return res.status(404).json({ message: "No provider connection found" });
      const credentialVersion = existing.credentialVersion;
      if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 0) {
        return res.status(409).json({ message: "Connection version unavailable; reconnect before refreshing" });
      }
      let connectionChanged = false;
      const result = await refreshProviderAccessToken(provider, {
        provider,
        accessToken: existing?.accessToken ?? null,
        refreshToken: existing?.refreshToken ?? null,
      }, async credentials => {
        const updated = await storage.compareAndSwapSocialCredentials(scope, existing.id, credentialVersion, credentials);
        if (!updated) {
          connectionChanged = true;
          throw new Error("Connection changed while refreshing; reload Connections");
        }
      });

      if (connectionChanged) return res.status(409).json({ provider: definition.key,
        result: { success: false, status: "failed", provider: definition.key, reason: "Connection changed while refreshing; reload Connections before retrying" } });
      return res.json({
        provider: definition.key,
        result: { success: result.success, status: result.status, provider: definition.key, tokenExpiresAt: result.tokenExpiresAt, reason: result.reason },
      });
    } catch {
      console.error("Error refreshing integration");
      return res.status(500).json({ message: "Failed to refresh integration" });
    }
  });

  app.post("/api/integrations/:provider/connect", requireDbUser, requirePermission("social:connect:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const provider = normalizeProviderKey(req.params.provider);
      const definition = resolveProviderDefinition(provider);
      if (!definition) {
        return res.status(400).json({ message: `Provider ${provider} is not supported` });
      }

      // OAuth requires its existing state-bound flow; other providers require
      // dedicated fields/verification. Never fabricate a manual connection.
      if (!["devto", "hashnode"].includes(provider)) {
        return res.status(400).json({ message: "Use the provider-specific verified connection flow; generic connection is not supported" });
      }
      const validation = z.object({ accessToken: rawCredential(20, 256) }).strict().safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid provider connection payload" });
      }

      const verified = provider === "devto"
        ? await verifyDevToApiKey(validation.data.accessToken)
        : await resolveHashnodePublication(validation.data.accessToken);
      if ("error" in verified) return res.status(400).json({ message: "Could not verify provider credentials" });
      const existing = await storage.getSocialAccountByProvider(scope, provider);
      const payload = {
        provider,
        providerAccountId: "publicationId" in verified ? verified.publicationId : "devto",
        accountName: definition.label,
        accessToken: validation.data.accessToken,
        refreshToken: null,
        scopes: provider === "devto" ? ["articles:write"] : ["post:write"],
        tokenExpiresAt: null,
        isActive: true,
      };

      let connection;
      if (existing) {
        connection = await storage.updateSocialAccount(scope, existing.id, payload);
      } else {
        connection = await storage.createSocialAccount(scope, payload);
      }

      if (!connection) return res.status(409).json({ message: "Connection changed; retry the verified connection flow" });
      const assessment = assessProviderConnection(provider, connection ?? null);
      return res.json({
        success: true,
        provider: definition.key,
        instance: connection ? toSafeSocialAccount(connection) : null,
        assessment,
      });
    } catch {
      console.error("Error connecting integration");
      return res.status(500).json({ message: "Failed to connect integration" });
    }
  });

  app.delete("/api/integrations/:provider/disconnect", requireDbUser, requirePermission("social:connect:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const provider = normalizeProviderKey(req.params.provider);
      const definition = resolveProviderDefinition(provider);
      if (!definition) {
        return res.status(400).json({ message: `Provider ${provider} is not supported` });
      }

      const existing = await storage.getSocialAccountByProvider(scope, provider);
      if (!existing) {
        return res.status(404).json({ message: `No connection found for ${definition.key}` });
      }

      await storage.deleteSocialAccount(scope, existing.id);
      return res.json({ success: true, provider: definition.key, message: `${definition.label} disconnected` });
    } catch {
      console.error("Error disconnecting integration");
      return res.status(500).json({ message: "Failed to disconnect integration" });
    }
  });

  app.post("/api/integrations/test", requireDbUser, async (req, res) => {
    try {
      const validation = providerSandboxSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid integration test payload", errors: validation.error.errors });
      }

      const provider = resolveProviderDefinition(validation.data.provider);
      if (!provider) {
        return res.status(400).json({ message: `Provider ${validation.data.provider} is not supported` });
      }

      const result = await runProviderSandbox({
        provider: provider.key,
        content: validation.data.content,
        mode: validation.data.mode,
        metadata: validation.data.metadata,
      });

      return res.json(result);
    } catch {
      console.error("Error testing integration");
      return res.status(500).json({ message: "Failed to test integration" });
    }
  });
}
