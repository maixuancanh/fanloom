import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL(String.fromCharCode(46, 46, 47) + "prisma/migrations/20260825210000_task5_event_scope/migration.sql", import.meta.url), "utf8");

describe("Task 5 event scope migration", () => {
  it("backfills from the authoritative Fan relation and leaves remediation evidence", () => {
    expect(migration).toMatch(/UPDATE\s+"EngagementEvent"/i);
    expect(migration).toMatch(/FROM\s+"Fan"/i);
    expect(migration).toMatch(/Backfill/i);
    expect(migration).toMatch(/NULL/i);
    expect(migration).toMatch(/ProviderEventScopeRemediation/i);
    expect(migration).not.toMatch(/RAISE\s+EXCEPTION/i);
    expect(migration).not.toMatch(/ALTER COLUMN "tenantId" SET NOT NULL/i);
    const enforcement = readFileSync(new URL(String.fromCharCode(46, 46, 47) + "prisma/migrations/20260825223000_enforce_event_scope/migration.sql", import.meta.url), "utf8");
    expect(enforcement).toMatch(/RAISE\s+EXCEPTION/i);
    expect(enforcement).toMatch(/ALTER COLUMN "tenantId" SET NOT NULL/i);
  });

  it("does not use the old provider-global uniqueness key", () => {
    const fingerprintMigration = readFileSync(new URL(String.fromCharCode(46, 46, 47) + "prisma/migrations/20260825213000_task5_event_fingerprint/migration.sql", import.meta.url), "utf8");
    expect(fingerprintMigration).toMatch(/fingerprint/i);
    expect(fingerprintMigration).toMatch(/tenantId_provider_providerEventId/i);
    expect(fingerprintMigration).toMatch(/DROP INDEX/i);
  });

  it("uses the runtime canonical length-prefixed field format for fingerprints", () => {
    const fingerprintMigration = readFileSync(new URL(String.fromCharCode(46, 46, 47) + "prisma/migrations/20260825213000_task5_event_fingerprint/migration.sql", import.meta.url), "utf8");
    expect(fingerprintMigration).toMatch(/octet_length/i);
    expect(fingerprintMigration).toMatch(/occurredAt.*MS.*Z/i);
    expect(fingerprintMigration).not.toMatch(/concat_ws\('\|'/i);
  });

  it("adds the audit foreign key to the durable outbox row", () => {
    const auditMigration = readFileSync(new URL(String.fromCharCode(46, 46, 47) + "prisma/migrations/20260825220000_mind_evaluation_audit/migration.sql", import.meta.url), "utf8");
    expect(auditMigration).toMatch(/FOREIGN KEY \("outboxJobId"\) REFERENCES "OutboxJob"\("id"\)/i);
    expect(auditMigration).toMatch(/ON DELETE RESTRICT/i);
  });
});
