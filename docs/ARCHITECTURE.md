# Fanloom architecture

Fanloom is a creator-growth workspace built from three independently deployable services: a React web application, a Fastify API, and a background worker. PostgreSQL is the durable system of record, while a transactional outbox connects user-facing requests to asynchronous work.

## Service boundaries

- **Web** renders the creator workspace and calls only the Fanloom API.
- **API** authenticates users, enforces tenant and creator boundaries, validates CSRF, and persists domain changes.
- **Worker** claims outbox jobs, runs due-checkpoint sweeps, calls external providers, and writes validated results.
- **PostgreSQL** stores creator profiles, consent, events, campaigns, outbox jobs, and Mind audit checkpoints.

## Mind boundary

Each creator uses a stable, creator-scoped conversation alias. Later requests therefore continue the same strategic context instead of opening unrelated conversations.

A Mind response is accepted only when it matches the configured identity and advisory contract:

- recommendation type is `partner_lead`, `outreach_draft`, `social_plan`, or `no_action`;
- evidence IDs are limited to consented events supplied with the request;
- the result contains reviewable draft content and an optional follow-up time;
- the response grants no authority to send, spend, reward, approve, or execute.

Accepted results are stored as immutable `MindAdvisorAudit` checkpoints. Raw transcripts are not exposed through the dashboard API.

## Autonomous continuity

The worker scans due checkpoints once per minute. Before creating a child evaluation, it confirms that the referenced events still belong to the creator and that each related fan still has active personalization consent. The resulting outbox job is idempotent for the parent checkpoint and follow-up date.

An autonomous follow-up is another advisory request. It cannot create or approve campaign actions and cannot call communication or payment connectors.

## Creator-controlled actions

Campaign actions live outside the Mind workflow. A creator creates the campaign, prepares an action, approves it, and explicitly requests execution through a connector. This separation keeps planning reviewable and makes every real-world side effect attributable to a creator decision.
