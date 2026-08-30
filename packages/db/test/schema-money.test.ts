import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");

describe("Prisma money columns", () => {
  it("allow the same three-to-ten character currency codes as domain validation", async () => {
    const schema = await readFile(schemaPath, "utf8");
    expect(schema.match(/currency\s+String\??\s+@db\.VarChar\(10\)/g)).toHaveLength(3);
    expect(schema).not.toMatch(/currency\s+String\??\s+@db\.VarChar\(3\)/);
  });
});
