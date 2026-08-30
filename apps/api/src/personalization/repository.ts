import type { Session } from "../auth/session.js";

type ConsentDb = { consentGrant: { findMany(args: unknown): Promise<Array<{ fanId: string }>> } };
type Scope = { tenantId: string; communityId: string; creatorId: string };

export class PersonalizationRepository {
  constructor(private readonly db: ConsentDb) {}

  async listEligibleFans(scope: Scope): Promise<string[]> {
    const grants = await this.db.consentGrant.findMany({ where: Object.assign({}, scope, { purpose: "personalization", status: "active", revokedAt: null }) });
    return grants.map((grant) => grant.fanId);
  }
}

export function requirePersonalizationConsent(repository: PersonalizationRepository) {
  return async (request: { session?: Pick<Session, "tenantId">; fanId?: string; communityId?: string; creatorId?: string }, reply: { code(status: number): unknown }) => {
    if (!request.session || !request.fanId || !request.communityId || !request.creatorId) return reply.code(403);
    const eligible = await repository.listEligibleFans({ tenantId: request.session.tenantId, communityId: request.communityId, creatorId: request.creatorId });
    return eligible.includes(request.fanId) ? undefined : reply.code(403);
  };
}
