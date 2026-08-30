import { describe, expect, it } from "vitest";
import { scoreConsentedEvidence } from "../src/scoring.js";
import { nextCampaignState, canExecuteCampaignAction, type CampaignActionInput } from "../src/campaign.js";
import { BudgetLedger, canSpend } from "../src/budget.js";

describe("campaign safety domain", () => {
  it("scores only evidence with active personalization consent", () => {
    expect(scoreConsentedEvidence([
      { eventId: "follow-1", kind: "follow.created", consented: true },
      { eventId: "comment-1", kind: "comment.created", consented: false },
      { eventId: "mission-1", kind: "mission.completed", consented: true },
    ])).toEqual({ score: 8, evidenceEventIds: ["follow-1", "mission-1"] });
  });

  it("requires approval before a financial proposal can execute", () => {
    expect(nextCampaignState({ state: "proposed", financial: true, approved: false })).toBe("awaiting_approval");
    expect(canExecuteCampaignAction({ actionType: "reward", approved: false, consented: true, amountMinor: 100, maxSpendMinor: 100 })).toEqual({ ok: false, reason: "approval_required" });
  });

  it("rejects an invalid state transition", () => {
    expect(() => nextCampaignState({ state: "completed", financial: false, approved: true })).toThrow("invalid_campaign_transition");
  });

  it("blocks a reward above the remaining campaign budget", () => {
    expect(canSpend({ limitMinor: 1000, spentMinor: 800, requestedMinor: 300 })).toBe(false);
  });

  it("reserves spend atomically and rejects overspend and duplicate idempotency keys", () => {
    const ledger = new BudgetLedger({ limitMinor: 1000 });
    expect(ledger.reserve({ amountMinor: 700, idempotencyKey: "action-1" })).toEqual({ ok: true, spentMinor: 700 });
    expect(ledger.reserve({ amountMinor: 400, idempotencyKey: "action-2" })).toEqual({ ok: false, reason: "budget_exceeded" });
    expect(ledger.reserve({ amountMinor: 700, idempotencyKey: "action-1" })).toEqual({ ok: false, reason: "duplicate_idempotency_key" });
  });

  it("rejects unconsented or unbounded actions", () => {
    const input: CampaignActionInput = { actionType: "message", approved: true, consented: false, amountMinor: 0, maxSpendMinor: 0 };
    expect(canExecuteCampaignAction(input)).toEqual({ ok: false, reason: "consent_required" });
    expect(canExecuteCampaignAction(Object.assign({}, input, { consented: true, amountMinor: 1, maxSpendMinor: 0 }))).toEqual({ ok: false, reason: "action_out_of_bounds" });
  });
});
