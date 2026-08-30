export type CampaignState = "draft" | "proposed" | "awaiting_approval" | "approved" | "executing" | "completed" | "failed" | "reconciled";
export type CampaignActionType = "message" | "mission" | "reward" | "tip" | "no_action";

export type CampaignActionInput = {
  actionType: CampaignActionType;
  approved: boolean;
  consented: boolean;
  amountMinor: number;
  maxSpendMinor: number;
};

export function isFinancialAction(actionType: CampaignActionType): boolean {
  return actionType === "reward" || actionType === "tip";
}

export function nextCampaignState(input: { state: CampaignState; financial: boolean; approved: boolean; succeeded?: boolean; reconciled?: boolean }): CampaignState {
  switch (input.state) {
    case "draft": return "proposed";
    case "proposed": return input.financial && !input.approved ? "awaiting_approval" : "approved";
    case "awaiting_approval": return input.approved ? "approved" : "awaiting_approval";
    case "approved": return "executing";
    case "executing":
      if (input.succeeded === undefined) throw new Error("invalid_campaign_transition");
      return input.succeeded ? "completed" : "failed";
    case "completed":
      if (!input.reconciled) throw new Error("invalid_campaign_transition");
      return "reconciled";
    case "failed": return "proposed";
    case "reconciled":
    default: throw new Error("invalid_campaign_transition");
  }
}

export function canExecuteCampaignAction(input: CampaignActionInput): { ok: true } | { ok: false; reason: "approval_required" | "consent_required" | "action_out_of_bounds" | "invalid_amount" } {
  if (!input.consented) return { ok: false, reason: "consent_required" };
  if (isFinancialAction(input.actionType) && !input.approved) return { ok: false, reason: "approval_required" };
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0 || !Number.isSafeInteger(input.maxSpendMinor) || input.maxSpendMinor < 0) return { ok: false, reason: "invalid_amount" };
  if (input.amountMinor > input.maxSpendMinor) return { ok: false, reason: "action_out_of_bounds" };
  return { ok: true };
}
