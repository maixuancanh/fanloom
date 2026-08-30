import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type SessionRole = "creator" | "fan" | "moderator";
export type Session = { userId: string; role: SessionRole; tenantId: string; expiresAt: number; sessionId: string };

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");
const secretFor = (secret?: string) => secret ?? process.env.FANLOOM_SESSION_SECRET ?? "fanloom-test-session-secret";
const sign = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("base64url");

export function createCsrfToken(sessionToken: string, origin: string, secret?: string): string {
  return sign(`csrf:${origin}:${sessionToken}`, secretFor(secret));
}

export function verifyCsrfToken(token: string | undefined, sessionToken: string, origin: string, secret?: string): boolean {
  if (!token) return false;
  const expected = createCsrfToken(sessionToken, origin, secret);
  return token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function issueSession(input: { userId: string; role: SessionRole; tenantId: string; sessionId?: string; expiresAt?: number }, secret?: string): string {
  const payload: Session = {
    userId: input.userId,
    role: input.role,
    tenantId: input.tenantId,
    sessionId: input.sessionId ?? randomUUID(),
    expiresAt: input.expiresAt ?? Date.now() + 15 * 60_000,
  };
  const body = encode(JSON.stringify(payload));
  return `${body}.${sign(body, secretFor(secret))}`;
}

export function verifySession(token: string | undefined, secret?: string): Session | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, provided] = parts;
  if (!body || !provided) return null;
  const expected = sign(body, secretFor(secret));
  if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(decode(body)) as Session;
    if (typeof session.userId !== "string" || !session.userId || typeof session.tenantId !== "string" || !session.tenantId || typeof session.sessionId !== "string" || !session.sessionId || typeof session.expiresAt !== "number" || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
    if (!["creator", "fan", "moderator"].includes(session.role)) return null;
    return session;
  } catch {
    return null;
  }
}
