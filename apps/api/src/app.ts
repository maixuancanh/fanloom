import Fastify from "fastify";
import { DEFAULT_ALLOWED_ORIGIN } from "../../../packages/config/src/runtime-urls.js";
import { db as defaultDb } from "../../../packages/db/src/client.js";
import { registerConsentRoutes } from "./routes/consent.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerCampaignRoutes } from "./routes/campaigns.js";
import { registerTipRoutes } from "./routes/tips.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { createCsrfToken, issueSession } from "./auth/session.js";

export function buildApp(options?: { db?: any; sessionSecret?: string; allowedOrigin?: string; rateLimit?: number; eventProviderSecrets?: Record<string, string>; eventProviderBindings?: Record<string, { tenantId: string; communityId: string }>; eventTimestampToleranceSeconds?: number; localDemo?: boolean }) {
  const sessionSecret = options?.sessionSecret ?? process.env.FANLOOM_SESSION_SECRET;
  if (!sessionSecret && process.env.NODE_ENV === "production") throw new Error("fanloom_session_secret_required");
  const app = Fastify({ logger: true });
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && (options?.localDemo || process.env.FANLOOM_LOCAL_DEMO === "true")) reply.header("access-control-allow-origin", origin).header("access-control-allow-credentials", "true").header("access-control-allow-headers", "Authorization, Content-Type, Idempotency-Key, X-CSRF-Token");
    if (request.method === "OPTIONS") return reply.code(204).send();
  });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    (request as typeof request & { rawBody?: Buffer }).rawBody = body as Buffer;
    try { done(null, JSON.parse((body as Buffer).toString("utf8"))); } catch { done(new Error("invalid_json")); }
  });
  app.get("/health", async () => ({ service: "fanloom-api", status: "ok" }));
  app.post("/v1/auth/local", async (_request, reply) => {
    if (!options?.localDemo && process.env.FANLOOM_LOCAL_DEMO !== "true") return reply.code(404).send({ error: "not_found" });
    const localDb = options?.db ?? defaultDb;
    let user = await localDb.user.findUnique({ where: { id: "00000000-0000-0000-0000-000000000001" }, include: { creator: true } });
    const demoProfile = { displayName: "Linh", niche: "Vietnamese indie-pop music", audience: "Vietnamese listeners aged 18-28 who follow indie and pop music", priorityChannels: ["Instagram", "TikTok"], goal30Day: "Gain 300 Instagram followers and qualify 5 partner leads", differentiator: "Intimate bilingual songs shaped by contemporary Vietnamese city life" };
    if (!user && localDb.user.upsert) user = await localDb.user.upsert({ where: { id: "00000000-0000-0000-0000-000000000001" }, update: {}, create: { id: "00000000-0000-0000-0000-000000000001", email: "creator@fanloom.local", role: "creator", tenantId: "00000000-0000-0000-0000-000000000003", communityId: "00000000-0000-0000-0000-000000000002", creator: { create: { ...demoProfile, tenantId: "00000000-0000-0000-0000-000000000003", communityId: "00000000-0000-0000-0000-000000000002" } } }, include: { creator: true } });
    if (user && !user.creator && localDb.creator?.upsert) user = { ...user, creator: await localDb.creator.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, ...demoProfile, tenantId: user.tenantId, communityId: user.communityId } }) };
    if (!user?.creator) return reply.code(503).send({ error: "local_creator_not_seeded" });
    if (localDb.creator?.update && (!user.creator.niche || !user.creator.audience || !Array.isArray(user.creator.priorityChannels) || !user.creator.priorityChannels.length || !user.creator.goal30Day || !user.creator.differentiator)) {
      user = { ...user, creator: await localDb.creator.update({ where: { id: user.creator.id }, data: { displayName: user.creator.displayName === "Local Creator" ? demoProfile.displayName : user.creator.displayName, niche: user.creator.niche ?? demoProfile.niche, audience: user.creator.audience ?? demoProfile.audience, priorityChannels: Array.isArray(user.creator.priorityChannels) && user.creator.priorityChannels.length ? user.creator.priorityChannels : demoProfile.priorityChannels, goal30Day: user.creator.goal30Day ?? demoProfile.goal30Day, differentiator: user.creator.differentiator ?? demoProfile.differentiator } }) };
    }
    if (localDb.user.update) user = { ...user, ...(await localDb.user.update({ where: { id: user.id }, data: { role: "creator" } })) };
    const fixtureFanId = "00000000-0000-0000-0000-000000000004", fixtureEventId = "00000000-0000-0000-0000-000000000005";
    if (localDb.fan?.upsert && localDb.consentGrant?.upsert && localDb.engagementEvent?.upsert) {
      if (localDb.user.upsert) await localDb.user.upsert({ where: { id: "00000000-0000-0000-0000-000000000006" }, update: {}, create: { id: "00000000-0000-0000-0000-000000000006", email: "fan@fanloom.local", role: "fan", tenantId: user.tenantId, communityId: user.communityId } });
      await localDb.fan.upsert({ where: { id: fixtureFanId }, update: {}, create: { id: fixtureFanId, userId: "00000000-0000-0000-0000-000000000006", handle: "local-fan", tenantId: user.tenantId, communityId: user.communityId, creatorId: user.creator.id } });
      await localDb.consentGrant.upsert({ where: { tenantId_fanId_purpose: { tenantId: user.tenantId, fanId: fixtureFanId, purpose: "personalization" } }, update: { status: "active", revokedAt: null }, create: { fanId: fixtureFanId, purpose: "personalization", status: "active", tenantId: user.tenantId, communityId: user.communityId, creatorId: user.creator.id } });
      await localDb.engagementEvent.upsert({ where: { id: fixtureEventId }, update: {}, create: { id: fixtureEventId, fanId: fixtureFanId, tenantId: user.tenantId, communityId: user.communityId, creatorId: user.creator.id, provider: "local", providerEventId: "local-follow-1", fingerprint: "0000000000000000000000000000000000000000000000000000000000000000", idempotencyKey: "local:follow.created:1", eventType: "follow.created", payload: { source: "local" }, occurredAt: new Date() } });
    }
    const token = issueSession({ userId: user.id, role: "creator", tenantId: user.tenantId }, sessionSecret ?? "fanloom-test-session-secret");
    const origin = (typeof _request.headers.origin === "string" ? _request.headers.origin : options?.allowedOrigin ?? process.env.FANLOOM_ALLOWED_ORIGIN ?? DEFAULT_ALLOWED_ORIGIN);
    return reply.send({ token, csrfToken: createCsrfToken(token, origin, sessionSecret ?? "fanloom-test-session-secret"), fixtureEventId, user: { id: user.id, role: "creator", displayName: user.creator.displayName } });
  });
  void registerConsentRoutes(app, {
    db: options?.db ?? defaultDb,
    sessionSecret: sessionSecret ?? "fanloom-test-session-secret",
    allowedOrigin: options?.allowedOrigin ?? process.env.FANLOOM_ALLOWED_ORIGIN ?? DEFAULT_ALLOWED_ORIGIN,
    rateLimit: options?.rateLimit,
  });
  void registerEventRoutes(app, { db: options?.db ?? defaultDb, providerSecrets: options?.eventProviderSecrets ?? {}, providerBindings: options?.eventProviderBindings ?? {}, timestampToleranceSeconds: options?.eventTimestampToleranceSeconds });
  void registerCampaignRoutes(app, { db: options?.db ?? defaultDb, sessionSecret: sessionSecret ?? "fanloom-test-session-secret" });
  void registerTipRoutes(app, { db: options?.db ?? defaultDb, sessionSecret: sessionSecret ?? "fanloom-test-session-secret" });
  void registerDashboardRoutes(app, {
    db: options?.db ?? defaultDb,
    sessionSecret: sessionSecret ?? "fanloom-test-session-secret",
    allowedOrigin: options?.allowedOrigin ?? process.env.FANLOOM_ALLOWED_ORIGIN ?? DEFAULT_ALLOWED_ORIGIN,
    localDemo: options?.localDemo ?? process.env.FANLOOM_LOCAL_DEMO === "true",
  });
  return app;
}
