# HelloMinds operations

Set `MINDS_BUILDER_API_KEY`, `FANLOOM_MIND_ID`, and optionally `MINDS_API_URL` on the worker only. Do not expose these variables through Vite, browser code, logs, or committed environment files.

The worker creates or resumes a stable creator-scoped conversation before sending an advisory request. Every response is checked against `FANLOOM_MIND_ID`, parsed as structured JSON, and validated against the supplied evidence and allowed recommendation types.

Operational checks:

1. Confirm the worker and API use the same `FANLOOM_DATABASE_URL`.
2. Confirm `FANLOOM_MIND_ID` points to the intended public Mind.
3. Check failed outbox jobs for authentication, rate-limit, malformed-response, or identity-mismatch errors.
4. Rotate the Builder API key if it appears in any client bundle, log, or shared terminal output.
5. Re-run the worker tests before changing retry, idempotency, or response-validation behavior.

Tests inject a client implementation and never require a live Builder API key.
