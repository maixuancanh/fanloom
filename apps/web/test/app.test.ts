import { describe, expect, it } from "vitest";
import { APP_NAME } from "../src/app.js";
import fs from "node:fs";
import path from "node:path";

describe("web identity", () => {
  it("exposes the Fanloom app name", () => {
    expect(APP_NAME).toBe("Fanloom");
  });
});

it("renders real workspace tabs instead of anchor placeholders", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "main.tsx"),
    "utf8",
  );
  expect(source).not.toMatch(
    /href="#(?:overview|campaigns|activity|settings)"/,
  );
  for (const view of [
    "overview",
    "campaigns",
    "audience",
    "activity",
    "settings",
  ])
    expect(source).toContain(`"${view}"`);
});

it("defines a landing screen that opens the existing workspace", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "main.tsx"),
    "utf8",
  );
  expect(source).toContain('type Screen = "landing" | "workspace"');
  expect(source).toContain("function LandingPage");
  expect(source).toContain("Open workspace");
});

it("uses the veee-style interaction for capability cards", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "main.tsx"),
    "utf8",
  );
  const styles = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "styles.css"),
    "utf8",
  );

  expect(source).not.toContain("persistent\n            <br />\n            by design");
  expect(styles).toContain(".landing-capability-grid article:hover");
  expect(styles).toContain("translateY(-6px)");
  expect(styles).toContain("cubic-bezier(0.2, 0.8, 0.2, 1)");
});

it("renders landing navigation as workspace-style pill buttons", () => {
  const styles = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "styles.css"),
    "utf8",
  );

  expect(styles).toContain(".landing-nav a {");
  expect(styles).toContain("background: var(--paper)");
  expect(styles).toContain("border-radius: 100px");
});

it("uses the Fanloom logo as the browser favicon", () => {
  const html = fs.readFileSync(
    path.join(import.meta.dirname, "..", "index.html"),
    "utf8",
  );

  expect(html).toContain('href="/fanloom-logo.png"');
});

it("keeps the public landing page independent from the workspace API", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "main.tsx"),
    "utf8",
  );

  expect(source).toContain('if (screen !== "workspace") return;');
});

it("shows creator brief completeness and Mind continuity evidence", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "main.tsx"), "utf8");
  expect(source).toContain("Creator brief");
  expect(source).toContain("Mind continuity");
  expect(source).toContain("Autonomous follow-up");
  expect(source).toContain("Manual request");
});

it("provides a bounded autonomous follow-up proof flow", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "main.tsx"), "utf8");
  expect(source).toContain("Run autonomous follow-up demo");
  expect(source).toContain('"making_due" | "waiting" | "complete" | "error"');
  expect(source).toContain("/v1/dashboard/advisor/follow-up-demo");
  expect(source).toContain("parentAuditId === parentAuditId");
  expect(source).toContain("FOLLOW_UP_POLL_ATTEMPTS");
  expect(source).toContain("followUpAbort.current?.abort()");
  expect(source).toContain("clearTimeout(timer)");
});

it("renders parent-child continuity without exposing legacy checkpoints", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "main.tsx"), "utf8");
  expect(source).toContain("Continues checkpoint");
  expect(source).toContain("continuityDepth");
  expect(source).toContain("Autonomous follow-up");
  expect(source).not.toContain("Legacy checkpoint");
});
