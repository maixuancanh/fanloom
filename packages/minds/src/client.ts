import type { MindClient, MindReply } from "./evaluate.js";
import type { AdvisorClient, AdvisorReply } from "./advisor.js";
import { createMindsClient, type MindsClient } from "@animocabrands/minds-client-lib";
import { DEFAULT_MINDS_API_URL } from "../../config/src/runtime-urls.js";

export type MindsHttpClientOptions = {
  apiKey: string; mindId: string; baseUrl: string; fetchImpl?: typeof fetch;
  mindsClient?: Pick<MindsClient, "ensureConversation" | "getMindIdForAlias" | "getLatestHistoryFingerprint" | "sendMessage" | "waitForReply">;
};
type MindsResponse = { mindId: string; requestId: string; transcriptRef?: string; payload: unknown };

export class MindsHttpClient implements MindClient, AdvisorClient {
  private readonly fetchImpl: typeof fetch;
  private readonly liveClient?: Pick<MindsClient, "ensureConversation" | "getMindIdForAlias" | "getLatestHistoryFingerprint" | "sendMessage" | "waitForReply">;
  constructor(private readonly options: MindsHttpClientOptions) {
    if (!options.apiKey) throw new Error("minds_builder_api_key_required");
    if (!options.mindId) throw new Error("fanloom_mind_id_required");
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!options.fetchImpl) this.liveClient = options.mindsClient ?? createMindsClient({ builderApiKey: options.apiKey });
  }

  async evaluate(input: { alias: string; events: readonly string[] }): Promise<MindReply> {
    if (this.liveClient) return this.evaluateLive(input);
    const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/v1/evaluate`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ mindId: this.options.mindId, alias: input.alias, events: input.events }),
    });
    if (!response.ok) throw new Error(`minds_http_${response.status}`);
    const value = await response.json() as Partial<MindsResponse>;
    if (typeof value.mindId !== "string" || typeof value.requestId !== "string" || !("payload" in value)) throw new Error("invalid_minds_response");
    return value as MindReply;
  }

  private async evaluateLive(input: { alias: string; events: readonly string[] }): Promise<MindReply> {
    const client = this.liveClient!;
    await client.ensureConversation(input.alias, this.options.mindId);
    const boundMindId = await client.getMindIdForAlias(input.alias);
    if (boundMindId && boundMindId !== this.options.mindId) throw new Error("minds_alias_mind_mismatch");
    const messageText = [
      "You are the assigned Fanloom campaign intelligence Mind for a creator.",
      "Use persistent memory to maintain continuity across campaign sessions.",
      "Return exactly one JSON object, with no markdown:",
      '{"summary":"short explanation","evidenceEventIds":["event-id"],"action":"message"|"mission"|"reward"|"no_action","maxSpendMinor":0,"requiresApproval":true,"followUpAt":"ISO timestamp optional"}',
      `Event IDs: ${JSON.stringify(input.events)}`,
      "When evidence is insufficient, return action no_action, maxSpendMinor 0, requiresApproval true, and state that human review is needed in summary. Do not invent event IDs or financial actions.",
    ].join("\n");
    const previous = await client.getLatestHistoryFingerprint(input.alias);
    const sent = await client.sendMessage({ alias: input.alias, messageText });
    const outcome = await client.waitForReply({ alias: input.alias, timeoutMs: 120_000, afterFingerprint: previous, sentMessageText: messageText });
    if (outcome.timedOut) throw new Error("minds_reply_timeout");
    const replyText = outcome.reply.messageText?.trim();
    if (!replyText) throw new Error("minds_reply_empty");
    let payload: unknown;
    try { payload = JSON.parse(replyText); } catch { throw new Error("minds_reply_invalid_json"); }
    return { mindId: this.options.mindId, requestId: typeof sent.messageId === "string" ? sent.messageId : crypto.randomUUID(), transcriptRef: outcome.reply.fingerprint, payload };
  }

  async advise(input: Parameters<AdvisorClient["advise"]>[0]): Promise<AdvisorReply> {
    if (!this.liveClient) return this.adviseLegacy(input);
    const alias = input.conversationAlias, client = this.liveClient;
    await client.ensureConversation(alias, this.options.mindId);
    const resolvedMindId = await client.getMindIdForAlias(alias);
    if (resolvedMindId && resolvedMindId !== this.options.mindId) throw new Error("foreign_mind_identity");
    const afterFingerprint = await client.getLatestHistoryFingerprint(alias);
    const messageText = [
      "You are Fanloom, the creator-growth advisor for independent creators.",
      "Return exactly one JSON object and no markdown or extra text with only these keys: summary, evidenceEventIds, recommendationType (partner_lead|outreach_draft|social_plan|no_action), draft, and optional followUpAt.",
      "You have no authority to send messages, create campaign actions, reward, tip, or spend. Provide advice and a draft only.",
      `Creator ID: ${input.creatorId}`,
      `Creator profile: ${JSON.stringify(input.creatorProfile)}`,
      `Previous accepted checkpoint: ${input.previousSummary ?? "None. Establish the first strategy checkpoint."}`,
      "Continue the same creator strategy across sessions. Do not discard confirmed profile facts or repeat questions already answered in the profile.",
      `Evidence event IDs: ${JSON.stringify(input.events)}`,
    ].join("\n");
    const sent = await client.sendMessage({ alias, messageText });
    if (typeof sent.messageId !== "string") throw new Error("invalid_minds_response");
    const outcome = await client.waitForReply({ alias, timeoutMs: 120_000, afterFingerprint, sentMessageText: messageText });
    if (outcome.timedOut || typeof outcome.reply.messageText !== "string") throw new Error("minds_reply_timeout");
    return { mindId: this.options.mindId, requestId: sent.messageId, transcriptRef: outcome.reply.fingerprint, payload: JSON.parse(outcome.reply.messageText) };
  }

  private async adviseLegacy(input: Parameters<AdvisorClient["advise"]>[0]): Promise<AdvisorReply> {
    const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/v1/advise`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`minds_http_${response.status}`);
    const value = await response.json() as Partial<MindsResponse>;
    if (typeof value.mindId !== "string" || typeof value.requestId !== "string" || !("payload" in value)) throw new Error("invalid_minds_response");
    return value as AdvisorReply;
  }
}

export function createMindsHttpClientFromEnv(): MindsHttpClient {
  return new MindsHttpClient({ apiKey: process.env.MINDS_BUILDER_API_KEY ?? "", mindId: process.env.FANLOOM_MIND_ID ?? "", baseUrl: process.env.MINDS_API_URL ?? DEFAULT_MINDS_API_URL });
}
