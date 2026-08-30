import { describe, expect, it } from "vitest";
import { canPersonalize } from "../src/consent.js";

describe("canPersonalize", () => {
  it("rejects revoked consent immediately", () => {
    expect(canPersonalize({ status: "revoked", purposes: ["personalization"] })).toBe(false);
  });

  it("requires the personalization purpose", () => {
    expect(canPersonalize({ status: "active", purposes: ["analytics"] })).toBe(false);
  });

  it("allows active personalization consent", () => {
    expect(canPersonalize({ status: "active", purposes: ["personalization"] })).toBe(true);
  });
});
