import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalEventFingerprint, isCompatibleEventFingerprint, isLegacyEventFingerprint, legacyEngagementEventFingerprint, normalizeEngagementEvent, verifyWebhookSignature } from "../src/channels/webhook.js";

describe("webhook contracts", () => {
  it("verifies the signed raw body within the replay window", () => {
    const rawBody = Buffer.from('{"providerEventId":"evt-1"}');
    const timestamp = 1_700_000_000;
    const signature = createHmac("sha256", "secret").update(`${timestamp}.${rawBody.toString()}`).digest("hex");
    expect(() => verifyWebhookSignature({ rawBody, signature: { provider: "p", timestamp, signature }, secret: "secret", nowSeconds: timestamp + 300 })).not.toThrow();
    expect(() => verifyWebhookSignature({ rawBody, signature: { provider: "p", timestamp: timestamp - 301, signature }, secret: "secret", nowSeconds: timestamp })).toThrow("stale_timestamp");
  });

  it("normalizes only the finite engagement kind set", () => {
    expect(normalizeEngagementEvent({ providerEventId: "evt-1", creatorId: "creator-1", kind: "follow.created", occurredAt: "2026-08-25T00:00:00.000Z", payload: { source: "community" } }, { provider: "p", tenantId: "tenant-1", communityId: "community-1" })).toMatchObject({ provider: "p", providerEventId: "evt-1", kind: "follow.created", creatorId: "creator-1" });
    expect(() => normalizeEngagementEvent({ providerEventId: "evt-1", creatorId: "creator-1", kind: "unknown", occurredAt: "2026-08-25T00:00:00.000Z", payload: {} }, { provider: "p", tenantId: "tenant-1", communityId: "community-1" })).toThrow("invalid_event_kind");
  });

  it("bounds and minimizes payload metadata", () => {
    const result = normalizeEngagementEvent({ providerEventId: "evt-1", creatorId: "creator-1", kind: "comment.created", occurredAt: "2026-08-25T00:00:00.000Z", payload: { source: "community", contentId: "post-1", text: "do not persist", email: "a@example.com", nested: { value: true } } }, { provider: "p", tenantId: "tenant-1", communityId: "community-1" });
    expect(result.payload).toEqual({ source: "community", contentId: "post-1" });
  });

  it("rejects oversized or deeply nested payloads", () => {
    expect(() => normalizeEngagementEvent({ providerEventId: "evt-1", creatorId: "creator-1", kind: "comment.created", occurredAt: "2026-08-25T00:00:00.000Z", payload: { source: "x".repeat(20_000) } }, { provider: "p", tenantId: "tenant-1", communityId: "community-1" })).toThrow("payload_too_large");
    expect(() => normalizeEngagementEvent({ providerEventId: "evt-1", creatorId: "creator-1", kind: "comment.created", occurredAt: "2026-08-25T00:00:00.000Z", payload: { source: { a: { b: { c: true } } } } }, { provider: "p", tenantId: "tenant-1", communityId: "community-1" })).toThrow("payload_too_deep");
  });

  it("uses the canonical field set and accepts a legacy fingerprint on retry", () => {
    const event = normalizeEngagementEvent({ providerEventId: "evt-1", creatorId: "creator-1", kind: "comment.created", occurredAt: "2026-08-25T00:00:00.000Z", payload: { source: "community" } }, { provider: "p", tenantId: "tenant-1", communityId: "community-1" });
    expect(canonicalEventFingerprint(event)).toMatch(/^[a-f0-9]{64}$/);
    expect(legacyEngagementEventFingerprint(event)).not.toBe(canonicalEventFingerprint(event));
    expect(isLegacyEventFingerprint(event, legacyEngagementEventFingerprint(event))).toBe(true);
    expect(isCompatibleEventFingerprint(event, legacyEngagementEventFingerprint(event))).toBe(false);
  });

  it("hashes the exact persisted JSON text representation", () => {
    const event = normalizeEngagementEvent({ providerEventId: "evt-1", creatorId: "creator-1", kind: "comment.created", occurredAt: "2026-08-25T00:00:00.000Z", payload: { source: "community", contentId: "post-1" } }, { provider: "p", tenantId: "tenant-1", communityId: "community-1" });
    const persistedJson = JSON.stringify({ contentId: "post-1", source: "community" });
    const reorderedInput = Object.assign({}, event, { payload: { source: "community", contentId: "post-1" } });
    expect(canonicalEventFingerprint(reorderedInput, persistedJson)).toBe(canonicalEventFingerprint(event, persistedJson));
  });
});
