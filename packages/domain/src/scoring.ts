export type ConsentedEvidence = {
  eventId: string;
  kind: string;
  consented: boolean;
};

const weights: Record<string, number> = {
  "follow.created": 3,
  "comment.created": 2,
  "mission.completed": 5,
  "tip.settled": 4,
  "creator.replied": 3,
};

export function scoreConsentedEvidence(evidence: readonly ConsentedEvidence[]) {
  const eligible = evidence.filter((item) => item.consented && item.eventId.length > 0);
  return {
    score: eligible.reduce((total, item) => total + (weights[item.kind] ?? 1), 0),
    evidenceEventIds: eligible.map((item) => item.eventId),
  };
}
