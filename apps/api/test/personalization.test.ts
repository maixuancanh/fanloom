import { describe, expect, it } from "vitest";
import { PersonalizationRepository, requirePersonalizationConsent } from "../src/personalization/repository.js";

describe("personalization consent boundary", () => {
  it("returns only active, tenant-scoped grants", async () => {
    const calls: any[] = [];
    const repo = new PersonalizationRepository({ consentGrant: { findMany: async (args: any) => { calls.push(args); return [{ fanId: "fan-1" }]; } } });
    await expect(repo.listEligibleFans({ tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-1" })).resolves.toEqual(["fan-1"]);
    expect(calls[0].where).toMatchObject({ tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-1", purpose: "personalization", status: "active", revokedAt: null });
  });

  it("rejects personalization middleware when consent is revoked or missing", async () => {
    const repo = new PersonalizationRepository({ consentGrant: { findMany: async () => [] } });
    const reply = { code: (status: number) => ({ status }) };
    await expect(requirePersonalizationConsent(repo)({ session: { tenantId: "tenant-1" }, fanId: "fan-1" }, reply)).resolves.toEqual({ status: 403 });
  });
});
