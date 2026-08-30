import { describe, expect, it } from "vitest";
import { evaluateCampaign } from "../src/evaluate.js";
import { MindsHttpClient } from "../src/client.js";
const good = { summary:"ok", evidenceEventIds:["evt-1"], action:"no_action", maxSpendMinor:0, requiresApproval:false };
describe("Fanloom Mind contract", () => {
  it("accepts typed evidence-backed decisions", async () => { const r=await evaluateCampaign({evaluate:async()=>({mindId:"fanloom",requestId:"r",payload:good})},{events:["evt-1"],configuredMindId:"fanloom",alias:"a"}); expect(r.ok).toBe(true); });
  it("rejects foreign identity and missing evidence", async () => { const c={evaluate:async()=>({mindId:"other",requestId:"r",payload:good})}; expect((await evaluateCampaign(c,{events:["evt-1"],configuredMindId:"fanloom",alias:"a"})).reason).toBe("foreign_mind_identity"); const d={evaluate:async()=>({mindId:"fanloom",requestId:"r",payload:{...good,evidenceEventIds:["missing"]}})}; expect((await evaluateCampaign(d,{events:["evt-1"],configuredMindId:"fanloom",alias:"a"})).reason).toBe("missing_evidence"); });

  it("uses the builder key only in a server-side authorization header", async () => {
    let received: RequestInit | undefined;
    const client = new MindsHttpClient({ apiKey: "builder-secret", mindId: "fanloom", baseUrl: new URL("https:" + "//minds.test").toString(), fetchImpl: async (_url, init) => { received = init; return new Response(JSON.stringify({ mindId: "fanloom", requestId: "req-1", transcriptRef: "tr-1", payload: good }), { status: 200, headers: { "content-type": "application/json" } }); } });
    await expect(client.evaluate({ alias: "engagement.evaluate", events: ["evt-1"] })).resolves.toMatchObject({ requestId: "req-1", transcriptRef: "tr-1" });
    expect(received?.headers).toMatchObject({ authorization: "Bearer builder-secret", "content-type": "application/json" });
    expect(JSON.stringify(received?.body)).not.toContain("builder-secret");
  });
});
