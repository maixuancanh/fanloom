import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifySession, type Session } from "../auth/session.js";

type Db = any;
const keyPattern = /^[\x21-\x7e]{1,255}$/;
const safeJson = (value: unknown) => JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));

export async function registerTipRoutes(app: FastifyInstance, options: { db: Db; sessionSecret: string }): Promise<void> {
  const auth = (request: FastifyRequest, reply: FastifyReply): Session | null => { const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined; const session = verifySession(token, options.sessionSecret); if (!session || session.role !== "fan") { void reply.code(403).send({ error: "forbidden" }); return null; } return session; };
  app.post<{ Body: { creatorId?: string; amountMinor?: number; currency?: string } }>("/v1/tips", async (request, reply) => {
    const session = auth(request, reply); if (!session) return;
    const raw = request.headers["idempotency-key"], key = Array.isArray(raw) ? raw[0] : raw;
    if (!key || !keyPattern.test(key)) return reply.code(400).send({ error: "idempotency_key_required" });
    const body = request.body ?? {};
    const creatorId = body.creatorId, currency = body.currency;
    const amountMinor = body.amountMinor;
    if (typeof creatorId !== "string" || typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || typeof currency !== "string" || !/^[A-Z0-9]{2,10}$/.test(currency)) return reply.code(400).send({ error: "invalid_tip" });
    const fan = await options.db.fan.findFirst({ where: { userId: session.userId, tenantId: session.tenantId } }); if (!fan) return reply.code(403).send({ error: "forbidden" });
    const existing = await options.db.tip.findUnique({ where: { idempotencyKey: key } }); if (existing) return reply.send(safeJson({ tip: existing, status: "pending" }));
    try {
      const result = await options.db.$transaction(async (tx: Db) => { const tip = await tx.tip.create({ data: { fanId: fan.id, creatorId, idempotencyKey: key, amountMinor: BigInt(amountMinor), currency, provider: "unprovisioned", status: "pending" } }); await tx.outboxJob.create({ data: { tenantId: session.tenantId, communityId: fan.communityId, topic: "tip.reconcile", idempotencyKey: key, payload: { tipId: tip.id, amountMinor, currency } } }); return tip; });
      return reply.code(202).send(safeJson({ tip: result, status: "pending" }));
    } catch (error) { if (error instanceof Error && /unique|duplicate/i.test(error.message)) { const tip = await options.db.tip.findUnique({ where: { idempotencyKey: key } }); if (tip) return reply.send(safeJson({ tip, status: "pending" })); } throw error; }
  });
}
