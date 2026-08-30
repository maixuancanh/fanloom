import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { engagementEventKinds, type EngagementEventKind, type NormalizedEngagementEvent, type WebhookSignature } from "./types.js";

export const DEFAULT_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;
export const MAX_FUTURE_TIMESTAMP_SKEW_SECONDS = 30;
const eventIdPattern = /^[\x21-\x7e]{1,255}$/;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_PAYLOAD_DEPTH = 3;
const payloadAllowlist = new Set(["source", "contentId", "reaction", "amountMinor", "currency", "missionId", "status", "platform", "contentType", "isPublic"]);
const sensitivePayloadKeys = /^(email|phone|token|secret|password|authorization|message|text|body|content)$/i;

export class WebhookVerificationError extends Error {
  constructor(public readonly reason: "missing_signature" | "unknown_provider" | "invalid_signature" | "stale_timestamp") {
    super(reason);
    this.name = "WebhookVerificationError";
  }
}

export function verifyWebhookSignature(input: { rawBody: Buffer; signature: WebhookSignature; secret: string; nowSeconds?: number; toleranceSeconds?: number }): void {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(input.signature.timestamp) || now - input.signature.timestamp > (input.toleranceSeconds ?? DEFAULT_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) || input.signature.timestamp - now > MAX_FUTURE_TIMESTAMP_SKEW_SECONDS) throw new WebhookVerificationError("stale_timestamp");
  if (!input.signature.signature || !input.secret) throw new WebhookVerificationError("missing_signature");
  const expected = createHmac("sha256", input.secret).update(`${input.signature.timestamp}.${input.rawBody.toString("utf8")}`).digest("hex");
  const provided = input.signature.signature.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(provided) || !timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided.toLowerCase(), "utf8"))) throw new WebhookVerificationError("invalid_signature");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 255) throw new Error(`invalid_${field}`);
  return value;
}

function payloadDepth(value: unknown, depth = 0): number {
  if (!value || typeof value !== "object") return depth;
  let maximum = depth;
  for (const item of Object.values(value as Record<string, unknown>)) maximum = Math.max(maximum, payloadDepth(item, depth + 1));
  return maximum;
}

function minimizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > MAX_PAYLOAD_BYTES) throw new Error("payload_too_large");
  if (payloadDepth(payload) > MAX_PAYLOAD_DEPTH) throw new Error("payload_too_deep");
  const minimized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (sensitivePayloadKeys.test(key) || !payloadAllowlist.has(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) minimized[key] = value;
  }
  return minimized;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  if (value instanceof Date) return value.toISOString();
  return value;
}

export type CanonicalEngagementEvent = { provider: string; providerEventId: string; tenantId: string; communityId: string; creatorId: string; fanId?: string; kind: string; occurredAt: Date; payload: Record<string, unknown> };
function lengthPrefixed(value: string): string { return `${Buffer.byteLength(value, "utf8")}:${value}`; }
/** Stable field order and representation shared by runtime and SQL backfills. */
export function canonicalEventFingerprint(event: CanonicalEngagementEvent, persistedPayloadText = JSON.stringify(canonicalize(event.payload))): string {
  const fields = [event.tenantId, event.communityId, event.provider, event.providerEventId, event.creatorId, event.fanId ?? "", event.kind, event.occurredAt.toISOString(), persistedPayloadText];
  return createHash("sha256").update(fields.map(lengthPrefixed).join("\n")).digest("hex");
}
/** Rows using the pre-canonical format require an explicit remediation migration. */
export function legacyEngagementEventFingerprint(event: CanonicalEngagementEvent): string {
  const sqlTimestamp = event.occurredAt.toISOString().replace("T", " ").replace("Z", "").replace(".000", "");
  return createHash("sha256").update([event.tenantId, event.provider, event.providerEventId, event.kind, sqlTimestamp, JSON.stringify(canonicalize(event.payload))].join("|")).digest("hex");
}
export function isLegacyEventFingerprint(event: CanonicalEngagementEvent, stored: string): boolean {
  return stored === legacyEngagementEventFingerprint(event);
}
export function isCompatibleEventFingerprint(event: CanonicalEngagementEvent, stored: string, persistedPayloadText = JSON.stringify(canonicalize(event.payload))): boolean {
  return stored === canonicalEventFingerprint(event, persistedPayloadText);
}

export function normalizeEngagementEvent(input: unknown, context: { provider: string; tenantId: string; communityId: string }): Omit<NormalizedEngagementEvent, "fanId"> & { fanId?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_event");
  const body = input as Record<string, unknown>;
  const kind = body.kind;
  if (typeof kind !== "string" || !(engagementEventKinds as readonly string[]).includes(kind)) throw new Error("invalid_event_kind");
  const providerEventId = requiredString(body.providerEventId, "provider_event_id");
  if (!eventIdPattern.test(providerEventId)) throw new Error("invalid_provider_event_id");
  const occurredAt = new Date(requiredString(body.occurredAt, "occurred_at"));
  if (Number.isNaN(occurredAt.getTime())) throw new Error("invalid_occurred_at");
  const payload = body.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_payload");
  const fanId = body.fanId === undefined ? undefined : requiredString(body.fanId, "fan_id");
  return Object.assign({
    provider: context.provider,
    providerEventId,
    tenantId: requiredString(context.tenantId, "tenant_id"),
    communityId: requiredString(context.communityId, "community_id"),
    creatorId: requiredString(body.creatorId, "creator_id"),
    kind: kind as EngagementEventKind,
    occurredAt,
    payload: minimizePayload(payload as Record<string, unknown>),
  }, fanId ? { fanId } : {});
}
