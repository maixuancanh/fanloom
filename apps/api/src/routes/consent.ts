import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireRole } from "../auth/authorize.js";
import { verifyCsrfToken, verifySession, type Session } from "../auth/session.js";

type Db = {
  user: { findFirst?(args: unknown): Promise<any>; findUnique(args: unknown): Promise<any> };
  fan: { findFirst?(args: unknown): Promise<any>; findUnique(args: unknown): Promise<any> };
  consentGrant: { upsert(args: unknown): Promise<any>; findUnique(args: unknown): Promise<any>; findMany(args: unknown): Promise<any[]> };
  idempotencyRecord: { create(args: unknown): Promise<any> };
  auditEvent: { create(args: unknown): Promise<any> };
  outboxJob: { create(args: unknown): Promise<any> };
  $transaction<T>(callback: (tx: Db) => Promise<T>): Promise<T>;
};
type Options = { db: Db; sessionSecret: string; allowedOrigin: string; rateLimit?: number };
type RequestWithAuth = FastifyRequest & { session?: Session; sessionToken?: string };
const purposePattern = /^[a-z][a-z0-9:_-]{1,63}$/;
const keyPattern = /^[\x21-\x7e]{1,255}$/;
const jsonSafe = (value: unknown) => JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
const clientError = (error: unknown) => error instanceof Error && /unique|duplicate/i.test(error.message);
async function reserve(tx: Db, session: Session, communityId: string, operation: string, resource: string, callerKey: string): Promise<void> {
  await tx.idempotencyRecord.create({ data: { tenantId: session.tenantId, communityId, actorId: session.userId, callerKey, operation, resource } });
}

export async function registerConsentRoutes(app: FastifyInstance, options: Options): Promise<void> {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const before = async (request: RequestWithAuth, reply: FastifyReply) => {
    const session = request.session;
    if (!session) return reply.code(401).send({ error: "unauthenticated" });
    const now = Date.now(), current = attempts.get(session.userId);
    if (!current || current.resetAt <= now) attempts.set(session.userId, { count: 1, resetAt: now + 60_000 });
    else if (++current.count > (options.rateLimit ?? 30)) return reply.code(429).send({ error: "rate_limited" });
    const csrf = request.headers["x-csrf-token"];
    if (["POST", "DELETE", "PUT", "PATCH"].includes(request.method) && (request.headers.origin !== options.allowedOrigin || !verifyCsrfToken(Array.isArray(csrf) ? csrf[0] : csrf, request.sessionToken ?? "", request.headers.origin ?? "", options.sessionSecret))) return reply.code(403).send({ error: "csrf_rejected" });
  };
  const userFor = async (s: Session) => options.db.user.findFirst ? options.db.user.findFirst({ where: { id: s.userId, tenantId: s.tenantId } }) : options.db.user.findUnique({ where: { id: s.userId } });
  const fanFor = async (s: Session) => options.db.fan.findFirst ? options.db.fan.findFirst({ where: { userId: s.userId, tenantId: s.tenantId } }) : options.db.fan.findUnique({ where: { userId: s.userId, tenantId: s.tenantId } });
  const audit = (db: Db, actorId: string, tenantId: string, communityId: string, action: string, key: string, metadata: unknown) => db.auditEvent.create({ data: { actorId, tenantId, communityId, action, idempotencyKey: key, metadata: jsonSafe(metadata) } });
  const getKey = (request: FastifyRequest, reply: FastifyReply) => { const raw = request.headers["idempotency-key"], key = Array.isArray(raw) ? raw[0] : raw; if (!key || !keyPattern.test(key)) { void reply.code(400).send({ error: "idempotency_key_required" }); return null; } return key; };
  app.addHook("preHandler", async (request: RequestWithAuth, reply) => {
    if (request.url === "/health" || request.url === "/v1/auth/local" || request.url === "/v1/dashboard/advisor/follow-up-demo" || request.url.startsWith("/v1/events")) return;
    const authorization = request.headers.authorization;
    const cookieToken = request.headers.cookie?.split(";").map((x) => x.trim()).find((x) => x.startsWith("fanloom_session="))?.slice("fanloom_session=".length);
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : cookieToken;
    const session = verifySession(token, options.sessionSecret), user = session ? await userFor(session) : null;
    const storedRole = user?.role === "admin" ? "moderator" : user?.role;
    request.sessionToken = token;
    request.session = session && user?.tenantId === session.tenantId && storedRole === session.role ? session : undefined;
    return before(request, reply);
  });
  app.post<{ Params: { purpose: string } }>("/v1/me/consent/:purpose", async (request, reply) => {
    const s = (request as RequestWithAuth).session; if (!s || !requireRole(s, ["fan"])) return reply.code(403).send({ error: "forbidden" });
    const { purpose } = request.params; if (!purposePattern.test(purpose)) return reply.code(400).send({ error: "invalid_purpose" });
    const key = getKey(request, reply); if (!key) return;
    const fan = await fanFor(s); if (!fan || fan.tenantId !== s.tenantId || fan.communityId == null || fan.creatorId == null) return reply.code(403).send({ error: "tenant_forbidden" });
    try { await options.db.$transaction(async (tx) => { await reserve(tx, s, fan.communityId, "consent.grant", purpose, key); const current = await tx.consentGrant.findUnique({ where: { tenantId_fanId_purpose: { tenantId: s.tenantId, fanId: fan.id, purpose } } }); if (current?.status === "revoked") throw new Error("consent_revoked"); await tx.consentGrant.upsert({ where: { tenantId_fanId_purpose: { tenantId: s.tenantId, fanId: fan.id, purpose } }, create: { tenantId: s.tenantId, communityId: fan.communityId, creatorId: fan.creatorId, fanId: fan.id, purpose, status: "active" }, update: { status: "active", revokedAt: null } }); await audit(tx, s.userId, s.tenantId, fan.communityId, "consent.granted", key, { fanId: fan.id, purpose, tenantId: s.tenantId }); }); } catch (e) { if (e instanceof Error && e.message === "consent_revoked") return reply.code(409).send({ error: "consent_revoked" }); if (clientError(e)) return reply.code(409).send({ error: "replayed_request" }); throw e; }
    return reply.code(204).send();
  });
  app.delete<{ Params: { purpose: string } }>("/v1/me/consent/:purpose", async (request, reply) => {
    const s = (request as RequestWithAuth).session; if (!s || !requireRole(s, ["fan"])) return reply.code(403).send({ error: "forbidden" });
    const { purpose } = request.params; if (!purposePattern.test(purpose)) return reply.code(400).send({ error: "invalid_purpose" }); const key = getKey(request, reply); if (!key) return;
    const fan = await fanFor(s); if (!fan || fan.tenantId !== s.tenantId || fan.communityId == null) return reply.code(403).send({ error: "tenant_forbidden" });
    try { await options.db.$transaction(async (tx) => { await reserve(tx, s, fan.communityId, "consent.revoke", purpose, key); const current = await tx.consentGrant.findUnique({ where: { tenantId_fanId_purpose: { tenantId: s.tenantId, fanId: fan.id, purpose } } }); if (current?.status === "revoked") throw new Error("consent_already_revoked"); await tx.consentGrant.upsert({ where: { tenantId_fanId_purpose: { tenantId: s.tenantId, fanId: fan.id, purpose } }, create: { tenantId: s.tenantId, communityId: fan.communityId, creatorId: fan.creatorId, fanId: fan.id, purpose, status: "revoked", revokedAt: new Date() }, update: { status: "revoked", revokedAt: new Date() } }); await tx.outboxJob.create({ data: { tenantId: s.tenantId, communityId: fan.communityId, idempotencyKey: `consent-revoked:${key}`, topic: "consent.revoked", payload: { fanId: fan.id, purpose, tenantId: s.tenantId } } }); await audit(tx, s.userId, s.tenantId, fan.communityId, "consent.revoked", key, { fanId: fan.id, purpose, tenantId: s.tenantId }); }); } catch (e) { if (e instanceof Error && e.message === "consent_already_revoked") return reply.code(409).send({ error: "consent_already_revoked" }); if (clientError(e)) return reply.code(409).send({ error: "replayed_request" }); throw e; }
    return reply.code(204).send();
  });
  app.get("/v1/me/export", async (request, reply) => { const s = (request as RequestWithAuth).session; if (!s || !requireRole(s, ["fan", "moderator"])) return reply.code(403).send({ error: "forbidden" }); if (s.role === "moderator") return reply.send({ fan: null, consents: [] }); const fan = await fanFor(s); if (!fan || fan.tenantId !== s.tenantId) return reply.code(403).send({ error: "tenant_forbidden" }); const consents = await options.db.consentGrant.findMany({ where: { tenantId: s.tenantId, fanId: fan.id } }); return reply.send({ fan: jsonSafe(fan), consents: jsonSafe(consents) }); });
  app.post("/v1/me/delete-request", async (request, reply) => {
    const s = (request as RequestWithAuth).session;
    if (!s || !requireRole(s, ["fan"])) return reply.code(403).send({ error: "forbidden" });
    const fan = await fanFor(s);
    if (!fan || fan.tenantId !== s.tenantId || !fan.communityId) return reply.code(403).send({ error: "tenant_forbidden" });
    const key = getKey(request, reply); if (!key) return;
    try {
      await options.db.$transaction(async (tx) => {
        await reserve(tx, s, fan.communityId, "fan.delete-request", "fan", key);
        await audit(tx, s.userId, s.tenantId, fan.communityId, "fan.delete_requested", key, { fanId: fan.id, tenantId: s.tenantId });
        await tx.outboxJob.create({ data: { tenantId: s.tenantId, communityId: fan.communityId, idempotencyKey: `delete-request:${key}`, topic: "fan.delete_requested", payload: { fanId: fan.id, tenantId: s.tenantId } } });
      });
    } catch (e) {
      if (clientError(e)) return reply.code(409).send({ error: "replayed_request" });
      throw e;
    }
    return reply.code(202).send({ status: "accepted", requestId: key });
  });
}
