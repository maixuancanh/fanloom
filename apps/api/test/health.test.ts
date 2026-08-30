import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("health", () => {
  it("reports Fanloom identity without external dependencies", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: "fanloom-api", status: "ok" });
  });
});
