export const engagementEventKinds = [
  "follow.created",
  "comment.created",
  "mission.completed",
  "tip.settled",
  "creator.replied",
] as const;

export type EngagementEventKind = (typeof engagementEventKinds)[number];

export type NormalizedEngagementEvent = {
  provider: string;
  providerEventId: string;
  tenantId: string;
  communityId: string;
  creatorId: string;
  fanId?: string;
  kind: EngagementEventKind;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

export type WebhookSignature = {
  provider: string;
  timestamp: number;
  signature: string;
};
