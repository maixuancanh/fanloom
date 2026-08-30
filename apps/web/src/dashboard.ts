export type DashboardAction = { id: string; actionType: string; status: string; executionStatus: string; amountMinor: string; maxSpendMinor: string };
export type DashboardCampaign = { id: string; name: string; status: string; budgetLimitMinor: string; spentMinor: string; actions: DashboardAction[] };
export type DashboardFan = { id: string; handle: string; joinedAt: string; engagementCount: number; rewardBalanceMinor: string; personalizationConsent: string };
export type DashboardCreatorProfile = { id: string; displayName: string; niche: string | null; audience: string | null; priorityChannels: string[]; goal30Day: string | null; differentiator: string | null; complete: boolean; missingFields: string[] };
export type DashboardAdvisorRecommendation = { id: string; summary: string; evidenceEventIds: string[]; recommendationType: string; draft: string; followUpAt?: string | null; mindId: string; conversationAlias: string; trigger: "manual" | "autonomous" | string; parentAuditId?: string | null; creatorProfileSnapshot: Partial<DashboardCreatorProfile>; continuityDepth: number; createdAt: string; draftOnly: true };

export function formatAdvisorDraft(draft: string): string {
  try {
    const parsed: unknown = JSON.parse(draft);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? JSON.stringify(parsed, null, 2) : draft;
  } catch {
    return draft;
  }
}

export function apiBase(): string {
  const configuredBase = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_FANLOOM_API_URL;
  return configuredBase ?? (typeof window === "undefined" ? "http://localhost:3001" : `${window.location.protocol}//${window.location.hostname}:3001`);
}

export async function loadCampaignDashboard(fetcher: typeof fetch = fetch, token?: string): Promise<DashboardCampaign[]> {
  const response = await fetcher(`${apiBase().replace(/\/$/, "")}/v1/dashboard/campaigns`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!response.ok) throw new Error(`dashboard_request_failed:${response.status}`);
  const data = await response.json() as { campaigns?: DashboardCampaign[] };
  return data.campaigns ?? [];
}

export async function loadAudienceDashboard(fetcher: typeof fetch = fetch, token?: string): Promise<DashboardFan[]> {
  const response = await fetcher(`${apiBase().replace(/\/$/, "")}/v1/dashboard/audience`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!response.ok) throw new Error(`audience_request_failed:${response.status}`);
  const data = await response.json() as { fans?: DashboardFan[] };
  return data.fans ?? [];
}

export async function loadAdvisorDashboard(fetcher: typeof fetch = fetch, token?: string): Promise<DashboardAdvisorRecommendation[]> {
  const response = await fetcher(`${apiBase().replace(/\/$/, "")}/v1/dashboard/advisor`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!response.ok) throw new Error(`advisor_request_failed:${response.status}`);
  const data = await response.json() as { recommendations?: DashboardAdvisorRecommendation[] };
  return data.recommendations ?? [];
}

export async function loadCreatorDashboard(fetcher: typeof fetch = fetch, token?: string): Promise<DashboardCreatorProfile> {
  const response = await fetcher(`${apiBase().replace(/\/$/, "")}/v1/dashboard/creator`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!response.ok) throw new Error(`creator_request_failed:${response.status}`);
  const data = await response.json() as { creator: DashboardCreatorProfile };
  return data.creator;
}

export function actionStatusLabel(action: Pick<DashboardAction, "status" | "executionStatus">): string {
  if (action.executionStatus === "unknown") return "Reconciliation pending";
  if (action.executionStatus === "succeeded" || action.status === "completed" || action.status === "executed") return "Executed";
  if (action.status === "awaiting_approval") return "Awaiting approval";
  if (action.status === "approved") return "Ready to execute";
  return "Pending";
}
