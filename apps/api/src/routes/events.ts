import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { canonicalEventFingerprint, isCompatibleEventFingerprint, isLegacyEventFingerprint, normalizeEngagementEvent, verifyWebhookSignature, WebhookVerificationError } from "../../../../packages/connectors/src/channels/webhook.js";

type EventDb = {
  engagementEvent: { create(args: unknown): Promise<{ id: string; [key: string]: unknown }>; findUnique(args: unknown): Promise<{ id: string; fingerprint?: string; [key: string]: unknown } | null> };
  outboxJob: { create(args: unknown): Promise<unknown> };
  fan: { findFirst(args: unknown): Promise<{ id: string; tenantId: string; communityId: string; creatorId: string } | null> };
  consentGrant: { findFirst(args: unknown): Promise<{ status: "active" | "revoked"; revokedAt: Date | null } | null> };
  $transaction<T>(callback: (tx: EventDb) => Promise<T>): Promise<T>;
};
type EventRequest = FastifyRequest & { rawBody?: Buffer };
type EventOptions = { db: EventDb; providerSecrets: Record<string, string>; providerBindings: Record<string, { tenantId: string; communityId: string }>; timestampToleranceSeconds?: number };

const safeJson = (value: unknown) => JSON.parse(JSON.stringify(value, (_, item) => item instanceof Date ? item.toISOString() : typeof item === "bigint" ? item.toString() : item));
const duplicateError = (error: unknown) => error instanceof Error && /unique|duplicate/i.test(error.message);

export async function registerEventRoutes(app: FastifyInstance, options: EventOptions): Promise<void> {
  app.post("/v1/events", async (request: EventRequest, reply: FastifyReply) => {
    const providerHeader = request.headers["x-fanloom-provider"];
    const timestampHeader = request.headers["x-fanloom-timestamp"];
    const signatureHeader = request.headers["x-fanloom-signature"];
    const provider = Array.isArray(providerHeader) ? providerHeader[0] : providerHeader;
    const timestamp = Number(Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader);
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const secret = provider ? options.providerSecrets[provider] : undefined;
    const binding = provider ? options.providerBindings[provider] : undefined;
    if (!provider || !secret || !binding || !signature || !Number.isSafeInteger(timestamp)) return reply.code(401).send({ error: "invalid_signature" });
    const headerTenant = request.headers["x-fanloom-tenant"];
    const headerCommunity = request.headers["x-fanloom-community"];
    if ((headerTenant !== undefined && headerTenant !== binding.tenantId) || (headerCommunity !== undefined && headerCommunity !== binding.communityId)) return reply.code(401).send({ error: "invalid_scope" });
    try {
      verifyWebhookSignature({ rawBody: request.rawBody ?? Buffer.from(JSON.stringify(request.body)), signature: { provider, timestamp, signature }, secret, toleranceSeconds: options.timestampToleranceSeconds });
    } catch (error) {
      if (error instanceof WebhookVerificationError) return reply.code(401).send({ error: "invalid_signature" });
      throw error;
    }
    let event;
    try {
      event = normalizeEngagementEvent(request.body, { provider, tenantId: binding.tenantId, communityId: binding.communityId });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid_event" });
    }
    try {
      const result = await options.db.$transaction(async (tx) => {
        const persistedPayloadText = JSON.stringify(event.payload, Object.keys(event.payload).sort());
        const fingerprint = canonicalEventFingerprint(event, persistedPayloadText);
        const existing = await tx.engagementEvent.findUnique({ where: { tenantId_provider_providerEventId: { tenantId: event.tenantId, provider: event.provider, providerEventId: event.providerEventId } } });
        if (existing) {
          if (isLegacyEventFingerprint(event, existing.fingerprint ?? "")) throw Object.assign(new Error("legacy_fingerprint_requires_remediation"), { statusCode: 409, remediation: "run the canonical fingerprint remediation before retrying this provider event" });
          if (!isCompatibleEventFingerprint(event, existing.fingerprint ?? "")) throw Object.assign(new Error("conflicting_duplicate"), { statusCode: 409 });
          return { event: existing, duplicate: true };
        }
        const fan = event.fanId ? await tx.fan.findFirst({ where: { id: event.fanId, tenantId: event.tenantId, communityId: event.communityId, creatorId: event.creatorId } }) : null;
        const consent = fan ? await tx.consentGrant.findFirst({ where: { tenantId: event.tenantId, communityId: event.communityId, creatorId: event.creatorId, fanId: fan.id, purpose: "personalization", status: "active", revokedAt: null } }) : null;
        const stored = await tx.engagementEvent.create({ data: Object.assign({}, event, { eventType: event.kind, fingerprint, idempotencyKey: `${event.tenantId}:${event.provider}:${event.providerEventId}`, payload: safeJson(event.payload) }) });
        const payload = Object.assign({ eventId: stored.id, kind: event.kind, creatorId: event.creatorId, tenantId: event.tenantId, communityId: event.communityId, personalizationEligible: Boolean(consent) }, consent && fan ? { fanId: fan.id } : {});
        await tx.outboxJob.create({ data: { tenantId: event.tenantId, communityId: event.communityId, topic: "engagement.evaluate", idempotencyKey: `${event.tenantId}:${event.provider}:${event.providerEventId}`, payload } });
        return { event: stored, duplicate: false };
      });
      return reply.code(result.duplicate ? 200 : 202).send({ eventId: result.event.id, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof Error && "statusCode" in error && error.statusCode === 409) {
        if (error.message === "legacy_fingerprint_requires_remediation") return reply.code(409).send({ error: error.message, remediation: "run the canonical fingerprint remediation before retrying this provider event" });
        return reply.code(409).send({ error: "conflicting_duplicate" });
      }
      if (duplicateError(error)) {
        const existing = await options.db.engagementEvent.findUnique({ where: { tenantId_provider_providerEventId: { tenantId: event.tenantId, provider: event.provider, providerEventId: event.providerEventId } } });
        if (existing) {
          if (isLegacyEventFingerprint(event, existing.fingerprint ?? "")) return reply.code(409).send({ error: "legacy_fingerprint_requires_remediation", remediation: "run the canonical fingerprint remediation before retrying this provider event" });
          if (!isCompatibleEventFingerprint(event, existing.fingerprint ?? "")) return reply.code(409).send({ error: "conflicting_duplicate" });
          return reply.code(200).send({ eventId: existing.id, duplicate: true });
        }
      }
      throw error;
    }
  });
}
