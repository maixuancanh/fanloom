import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  actionStatusLabel,
  apiBase,
  formatAdvisorDraft,
  loadAdvisorDashboard,
  loadAudienceDashboard,
  loadCampaignDashboard,
  loadCreatorDashboard,
  type DashboardAction,
  type DashboardAdvisorRecommendation,
  type DashboardCampaign,
  type DashboardCreatorProfile,
  type DashboardFan,
} from "./dashboard.js";
import "./styles.css";

type View = "overview" | "campaigns" | "audience" | "activity" | "settings";
type Screen = "landing" | "workspace";
type FollowUpDemoState = "idle" | "making_due" | "waiting" | "complete" | "error";
const FOLLOW_UP_POLL_ATTEMPTS = 30;
const FOLLOW_UP_POLL_INTERVAL_MS = 4_000;
const VIEWS: View[] = [
  "overview",
  "campaigns",
  "audience",
  "activity",
  "settings",
];
const META: Record<View, [string, string, string]> = {
  overview: [
    "CREATOR WORKSPACE",
    "Audience growth overview",
    "Campaigns, consented fans, spend, and actions that need attention.",
  ],
  campaigns: [
    "CAMPAIGNS",
    "Campaigns",
    "Create campaigns and move guarded actions through approval and execution.",
  ],
  audience: [
    "AUDIENCE",
    "Consented audience",
    "Relationship context is used only while each fan's consent remains active.",
  ],
  activity: [
    "AUDIT TRAIL",
    "Activity",
    "Review every proposed, approved, executed, and reconciled campaign action.",
  ],
  settings: [
    "WORKSPACE",
    "Settings",
    "Configure approval preferences and creator workspace defaults.",
  ],
};
const money = (minor: string | number) =>
  (Number(minor) / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
const tone = (status: string) =>
  ["active", "executed", "completed", "succeeded"].includes(status)
    ? "success"
    : ["pending", "awaiting_approval", "approved"].includes(status)
      ? "warning"
      : "neutral";

function waitFor(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [view, setView] = useState<View>("overview");
  const [campaigns, setCampaigns] = useState<DashboardCampaign[] | null>(null);
  const [fans, setFans] = useState<DashboardFan[] | null>(null);
  const [advisor, setAdvisor] = useState<
    DashboardAdvisorRecommendation[] | null
  >(null);
  const [creator, setCreator] = useState<DashboardCreatorProfile | null>(null);
  const [token, setToken] = useState(() =>
    localStorage.getItem("fanloom_token"),
  );
  const [csrf, setCsrf] = useState(() => localStorage.getItem("fanloom_csrf"));
  const [fixtureEventId, setFixtureEventId] = useState(() =>
    localStorage.getItem("fanloom_fixture_event"),
  );
  const [message, setMessage] = useState("Connecting to Fanloom…");
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignBudget, setCampaignBudget] = useState("100");
  const [followUpState, setFollowUpState] =
    useState<FollowUpDemoState>("idle");
  const followUpAbort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      followUpAbort.current?.abort();
    },
    [],
  );

  async function authenticate() {
    const response = await fetch(`${apiBase()}/v1/auth/local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok)
      throw new Error(`Local sign-in failed (${response.status})`);
    const result = (await response.json()) as {
      token: string;
      csrfToken: string;
      fixtureEventId: string;
    };
    localStorage.setItem("fanloom_token", result.token);
    localStorage.setItem("fanloom_csrf", result.csrfToken);
    localStorage.setItem("fanloom_fixture_event", result.fixtureEventId);
    setToken(result.token);
    setCsrf(result.csrfToken);
    setFixtureEventId(result.fixtureEventId);
    return result.token;
  }
  async function refresh(session = token) {
    if (!session) return;
    const [nextCampaigns, nextFans, nextAdvisor, nextCreator] = await Promise.all([
      loadCampaignDashboard(fetch, session),
      loadAudienceDashboard(fetch, session),
      loadAdvisorDashboard(fetch, session),
      loadCreatorDashboard(fetch, session),
    ]);
    setCampaigns(nextCampaigns);
    setFans(nextFans);
    setAdvisor(nextAdvisor);
    setCreator(nextCreator);
    setMessage("Workspace synchronized with the Fanloom API.");
  }
  useEffect(() => {
    if (screen !== "workspace") return;
    void (async () => {
      try {
        const session = token ?? (await authenticate());
        await refresh(session);
      } catch {
        try {
          localStorage.removeItem("fanloom_token");
          localStorage.removeItem("fanloom_csrf");
          setToken(null);
          setCsrf(null);
          const session = await authenticate();
          await refresh(session);
        } catch (error) {
          setMessage((error as Error).message);
        }
      }
    })();
  }, [screen]);

  async function createCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      const response = await fetch(`${apiBase()}/v1/campaigns`, {
        method: "POST",
        headers: authHeaders(token, csrf),
        body: JSON.stringify({
          name: campaignName,
          budgetLimitMinor: Math.round(Number(campaignBudget) * 100),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      setShowCreate(false);
      setCampaignName("");
      await refresh();
      setView("campaigns");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(
    campaignId: string,
    action: DashboardAction | null,
    operation: "create" | "approve" | "execute",
  ) {
    if (!token) return;
    setBusy(true);
    try {
      const path =
        operation === "create"
          ? `/v1/campaigns/${campaignId}/actions`
          : `/v1/campaigns/${campaignId}/actions/${action!.id}/${operation}`;
      const payload =
        operation === "create"
          ? {
              actionType: "message",
              amountMinor: 0,
              maxSpendMinor: 0,
              evidenceEventIds: fixtureEventId ? [fixtureEventId] : [],
            }
          : {};
      const response = await fetch(`${apiBase()}${path}`, {
        method: "POST",
        headers: authHeaders(token, csrf),
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await response.text());
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function requestAdvice() {
    if (!token || !fixtureEventId) {
      setMessage("A consented event is required before generating advice.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${apiBase()}/v1/dashboard/advisor/requests`,
        {
          method: "POST",
          headers: authHeaders(token, csrf),
          body: JSON.stringify({ eventIds: [fixtureEventId] }),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      setMessage(
        "Advice request queued. Fanloom will return a draft only; no campaign action will be taken.",
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runAutonomousFollowUpDemo() {
    if (!token || !csrf) {
      setMessage("Sign in before running the continuity proof.");
      return;
    }
    const checkpoint = advisor?.find((item) => item.conversationAlias);
    if (!checkpoint) {
      setMessage("Generate the first Mind checkpoint before running a follow-up.");
      return;
    }

    followUpAbort.current?.abort();
    const controller = new AbortController();
    followUpAbort.current = controller;
    setBusy(true);
    setFollowUpState("making_due");
    try {
      const response = await fetch(
        `${apiBase()}/v1/dashboard/advisor/follow-up-demo`,
        {
          method: "POST",
          headers: authHeaders(token, csrf),
          body: "{}",
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { auditId: string };
      const parentAuditId = result.auditId;
      setFollowUpState("waiting");
      setMessage(
        "Checkpoint is due. Waiting for Fanloom's autonomous, draft-only follow-up…",
      );

      for (let attempt = 0; attempt < FOLLOW_UP_POLL_ATTEMPTS; attempt += 1) {
        await waitFor(FOLLOW_UP_POLL_INTERVAL_MS, controller.signal);
        const next = await loadAdvisorDashboard(fetch, token);
        setAdvisor(next);
        const child = next.find(
          (item) =>
            item.trigger === "autonomous" && item.parentAuditId === parentAuditId,
        );
        if (child) {
          setFollowUpState("complete");
          setMessage(
            "Autonomous follow-up received as a reviewable draft. No campaign action was taken.",
          );
          return;
        }
      }
      throw new Error(
        "The bounded follow-up window ended before a child checkpoint arrived. Refresh to check worker progress.",
      );
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setFollowUpState("error");
      setMessage((error as Error).message);
    } finally {
      if (followUpAbort.current === controller) followUpAbort.current = null;
      setBusy(false);
    }
  }

  async function saveCreatorProfile(profile: Omit<DashboardCreatorProfile, "id" | "complete" | "missingFields">) {
    if (!token) return;
    setBusy(true);
    try {
      const response = await fetch(`${apiBase()}/v1/dashboard/creator`, {
        method: "PATCH",
        headers: authHeaders(token, csrf),
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json() as { creator: DashboardCreatorProfile };
      setCreator(result.creator);
      setMessage("Creator brief saved and ready for the next Mind checkpoint.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const actions =
    campaigns?.flatMap((campaign) =>
      campaign.actions.map((action) => ({
        ...action,
        campaignId: campaign.id,
        campaignName: campaign.name,
      })),
    ) ?? [];
  const budget =
    campaigns?.reduce((sum, item) => sum + Number(item.budgetLimitMinor), 0) ??
    0;
  const spent =
    campaigns?.reduce((sum, item) => sum + Number(item.spentMinor), 0) ?? 0;

  if (screen === "landing")
    return <LandingPage onOpenWorkspace={() => setScreen("workspace")} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand brand-button"
          type="button"
          aria-label="Return to Fanloom home"
          onClick={() => setScreen("landing")}
        >
          <span className="brand-mark">
            <img src="/fanloom-logo.png" alt="" />
          </span>
          <span>Fanloom</span>
        </button>
        <nav aria-label="Workspace navigation">
          {VIEWS.map((item) => (
            <button
              key={item}
              type="button"
              className={`nav-item ${view === item ? "active" : ""}`}
              onClick={() => setView(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">C</span>
          <div>
            <strong>Creator workspace</strong>
            <small>Independent local stack</small>
          </div>
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{META[view][0]}</p>
            <h1>{META[view][1]}</h1>
            <p className="subtitle">{META[view][2]}</p>
          </div>
          {["overview", "campaigns"].includes(view) && (
            <button
              className="primary-button"
              type="button"
              disabled={!token}
              onClick={() => setShowCreate(true)}
            >
              + New campaign
            </button>
          )}
        </header>
        <div className="notice" role="status">
          <strong>System status</strong>
          <span>{message}</span>
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {view === "overview" && (
          <>
            <section className="stats">
              <Stat
                label="Active campaigns"
                value={String(
                  campaigns?.filter((item) => item.status === "active")
                    .length ?? 0,
                )}
                help="Currently running"
              />
              <Stat
                label="Consented fans"
                value={String(
                  fans?.filter((fan) => fan.personalizationConsent === "active")
                    .length ?? 0,
                )}
                help="Eligible for personalization"
              />
              <Stat
                label="Campaign budget"
                value={money(budget)}
                help={`${money(spent)} used`}
              />
              <Stat
                label="Actions to review"
                value={String(
                  actions.filter((action) =>
                    ["pending", "awaiting_approval", "approved"].includes(
                      action.status,
                    ),
                  ).length,
                )}
                help="Approval or execution pending"
              />
            </section>
            <div className="continuity-grid">
              <CreatorBriefCard creator={creator} onEdit={() => setView("settings")} />
              <MindContinuity recommendations={advisor} />
            </div>
            <ContinuityProof
              recommendations={advisor}
              state={followUpState}
              busy={busy}
              onRun={() => void runAutonomousFollowUpDemo()}
            />
            <Section
              title="Fanloom growth advice"
              description="Creator-requested partner, outreach, and social drafts. Fanloom cannot send, reward, tip, spend, or execute a campaign action."
              action={
                <button
                  className="secondary-button"
                  disabled={busy || !token || !creator?.complete}
                  onClick={() => void requestAdvice()}
                >
                  Generate advice
                </button>
              }
            />
            <AdvisorPanel recommendations={advisor} />
            <Section
              title="Campaign snapshot"
              description="Current campaign health and next actions."
            />
            <CampaignGrid
              campaigns={campaigns?.slice(0, 2) ?? null}
              busy={busy}
              onAct={act}
              onCreate={() => setShowCreate(true)}
            />
            <Section
              title="Recent activity"
              description="Latest durable action states."
              action={
                <button
                  className="link-button"
                  onClick={() => setView("activity")}
                >
                  View all
                </button>
              }
            />
            <Activity actions={actions.slice(0, 5)} />
          </>
        )}
        {view === "campaigns" && (
          <>
            <Section
              title="Your campaigns"
              description="Budgeted campaigns with explicit action approval."
              action={
                <button
                  className="secondary-button"
                  onClick={() =>
                    setCampaigns((items) =>
                      items
                        ? [...items].sort((a, b) =>
                            a.name.localeCompare(b.name),
                          )
                        : items,
                    )
                  }
                >
                  Sort by name
                </button>
              }
            />
            <CampaignGrid
              campaigns={campaigns}
              busy={busy}
              onAct={act}
              onCreate={() => setShowCreate(true)}
            />
          </>
        )}
        {view === "audience" && <Audience fans={fans} />}{" "}
        {view === "activity" && <Activity actions={actions} />}{" "}
        {view === "settings" && (
          <Settings
            creator={creator}
            busy={busy}
            onSaveCreator={saveCreatorProfile}
            onSaved={() => setMessage("Workspace settings saved locally.")}
          />
        )}
        {showCreate && (
          <div className="modal-backdrop">
            <form className="modal" onSubmit={createCampaign}>
              <h2>New campaign</h2>
              <p>Set a measurable name and hard budget limit.</p>
              <label>
                Campaign name
                <input
                  autoFocus
                  required
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                />
              </label>
              <label>
                Budget (USD)
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={campaignBudget}
                  onChange={(event) => setCampaignBudget(event.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={busy}>
                  Create campaign
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

function LandingPage({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <a className="landing-brand" href="#top" aria-label="Fanloom home">
          <img src="/fanloom-logo.png" alt="" />
          <span>Fanloom</span>
        </a>
        <nav className="landing-nav" aria-label="Landing navigation">
          <a href="#product">Product</a>
          <a href="#how-it-works">How it works</a>
          <a href="#guardrails">Guardrails</a>
        </nav>
        <button
          className="landing-workspace-button"
          type="button"
          onClick={onOpenWorkspace}
        >
          Open workspace ↗
        </button>
      </header>

      <section className="landing-hero" id="top">
        <div className="landing-hero-copy">
          <p className="landing-kicker">CREATOR GROWTH, WITH CONTEXT</p>
          <h1>Growth clarity for independent creators.</h1>
          <p className="landing-lede">
            Fanloom keeps the working context, turns it into partner leads,
            social plans, and outreach drafts — then leaves every decision with
            you.
          </p>
          <div className="landing-actions">
            <button
              className="landing-primary-cta"
              type="button"
              onClick={onOpenWorkspace}
            >
              Open your workspace <span>→</span>
            </button>
            <a className="landing-secondary-cta" href="#how-it-works">
              See how it works
            </a>
          </div>
        </div>
        <div className="landing-hero-art" aria-hidden="true">
          <span className="landing-orbit landing-orbit-one" />
          <span className="landing-orbit landing-orbit-two" />
          <span className="landing-orbit-dot landing-orbit-dot-one" />
          <span className="landing-orbit-dot landing-orbit-dot-two" />
          <div className="landing-logo-float">
            <img src="/fanloom-logo.png" alt="" />
          </div>
        </div>
      </section>

      <section
        className="landing-proof"
        id="guardrails"
        aria-label="Fanloom principles"
      >
        <article>
          <span>01</span>
          <h2>Draft-only</h2>
          <p>
            Ideas and copy stay reviewable. Fanloom never sends, rewards, tips,
            or spends.
          </p>
        </article>
        <article>
          <span>02</span>
          <h2>Persistent context</h2>
          <p>
            Creator profiles, goals, partner leads, approved drafts, and
            follow-ups remain connected.
          </p>
        </article>
        <article>
          <span>03</span>
          <h2>Steward approval</h2>
          <p>
            The creator or their representative decides what is ready and what
            happens next.
          </p>
        </article>
      </section>

      <section className="landing-section" id="product">
        <p className="landing-kicker">WHAT FANS CAN'T SEE</p>
        <h2>
          One private workspace.
          <br />
          Three growth systems.
        </h2>
        <div className="landing-capability-grid">
          <article>
            <span className="landing-card-index">01</span>
            <h3>Partner leads</h3>
            <p>
              Find the people, venues, curators, and collaborators worth
              approaching next.
            </p>
            <small>LEAD PIPELINE</small>
          </article>
          <article>
            <span className="landing-card-index">02</span>
            <h3>Social planning</h3>
            <p>
              Shape focused content plans around a creator's audience, release
              cycle, and priority channels.
            </p>
            <small>CONTENT DIRECTION</small>
          </article>
          <article>
            <span className="landing-card-index">03</span>
            <h3>Outreach drafts</h3>
            <p>
              Write a precise first message with clear placeholders, evidence,
              and a steward-controlled send decision.
            </p>
            <small>REVIEWABLE COPY</small>
          </article>
        </div>
      </section>

      <section className="landing-workflow" id="how-it-works">
        <div>
          <p className="landing-kicker">A CLEARER WORKFLOW</p>
          <h2>Human judgment stays at the center.</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>Brief</h3>
              <p>
                Add the creator, audience, goal, and channel context that makes
                a recommendation useful.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Reviewable draft</h3>
              <p>
                Fanloom returns a concrete plan, partner lead, or outreach draft
                with its missing inputs visible.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Steward decides</h3>
              <p>
                Review, edit, approve, or discard. No automatic actions happen
                behind the scenes.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="landing-closing">
        <img src="/fanloom-logo.png" alt="" />
        <p className="landing-kicker">READY WHEN THE CREATOR IS</p>
        <h2>
          Build momentum
          <br />
          without losing control.
        </h2>
        <button
          className="landing-primary-cta"
          type="button"
          onClick={onOpenWorkspace}
        >
          Open your workspace <span>→</span>
        </button>
      </section>
    </main>
  );
}

function authHeaders(token: string, csrf: string | null) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
  };
}
function Stat({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help: string;
}) {
  return (
    <article className="stat-card">
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      <small>{help}</small>
    </article>
  );
}
function Section({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="section-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </section>
  );
}
function CampaignGrid({
  campaigns,
  busy,
  onAct,
  onCreate,
}: {
  campaigns: DashboardCampaign[] | null;
  busy: boolean;
  onAct: (
    id: string,
    action: DashboardAction | null,
    operation: "create" | "approve" | "execute",
  ) => void;
  onCreate: () => void;
}) {
  if (campaigns === null)
    return (
      <div className="panel empty">
        <div className="spinner" />
        <p>Loading campaigns…</p>
      </div>
    );
  if (!campaigns.length)
    return (
      <div className="panel empty">
        <h3>No campaigns yet</h3>
        <p>Create the first campaign to start a guarded creator workflow.</p>
        <button className="primary-button" onClick={onCreate}>
          Create campaign
        </button>
      </div>
    );
  return (
    <div className="campaign-grid">
      {campaigns.map((campaign) => (
        <article className="campaign-card" key={campaign.id}>
          <div className="campaign-top">
            <div className="campaign-icon">
              {campaign.name[0]?.toUpperCase()}
            </div>
            <div>
              <h3>{campaign.name}</h3>
              <span className={`badge ${tone(campaign.status)}`}>
                {campaign.status}
              </span>
            </div>
          </div>
          <div className="progress-label">
            <span>Budget used</span>
            <strong>
              {money(campaign.spentMinor)} / {money(campaign.budgetLimitMinor)}
            </strong>
          </div>
          <div className="progress">
            <span
              style={{
                width: `${Math.min(100, Number(campaign.budgetLimitMinor) ? (Number(campaign.spentMinor) / Number(campaign.budgetLimitMinor)) * 100 : 0)}%`,
              }}
            />
          </div>
          <div className="campaign-footer">
            <span>{campaign.actions.length} actions</span>
            <button
              className="link-button"
              disabled={busy}
              onClick={() => onAct(campaign.id, null, "create")}
            >
              Add action
            </button>
          </div>
          {campaign.actions.map((action) => (
            <div className="action-row" key={action.id}>
              <span>
                {action.actionType.replaceAll("_", " ")} ·{" "}
                {actionStatusLabel(action)}
              </span>
              {action.status === "pending" && (
                <button
                  className="link-button"
                  disabled={busy}
                  onClick={() => onAct(campaign.id, action, "approve")}
                >
                  Approve
                </button>
              )}
              {action.status === "approved" && (
                <button
                  className="link-button"
                  disabled={busy}
                  onClick={() => onAct(campaign.id, action, "execute")}
                >
                  Execute
                </button>
              )}
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}
function Activity({
  actions,
}: {
  actions: Array<
    DashboardAction & { campaignId: string; campaignName: string }
  >;
}) {
  return (
    <div className="panel activity-list">
      {!actions.length ? (
        <div className="empty">
          <h3>No activity yet</h3>
          <p>Add an action to a campaign and its lifecycle will appear here.</p>
        </div>
      ) : (
        actions.map((action) => (
          <div className="activity-row" key={action.id}>
            <span className={`activity-dot ${tone(action.status)}`} />
            <div>
              <strong>{actionStatusLabel(action)}</strong>
              <small>
                {action.campaignName} · {action.actionType.replaceAll("_", " ")}
              </small>
            </div>
            <span className="activity-amount">{money(action.amountMinor)}</span>
          </div>
        ))
      )}
    </div>
  );
}
function AdvisorPanel({
  recommendations,
}: {
  recommendations: DashboardAdvisorRecommendation[] | null;
}) {
  if (recommendations === null)
    return (
      <div className="panel empty">
        <p>Loading Fanloom advice…</p>
      </div>
    );
  if (!recommendations.length)
    return (
      <div className="panel empty">
        <h3>No advice yet</h3>
        <p>
          Generate advice to receive a reviewable outreach, partner, or social
          draft from Fanloom.
        </p>
      </div>
    );
  return (
    <div className="campaign-grid">
      {recommendations.map((item) => (
        <article className="campaign-card" key={item.id}>
          <div className="campaign-top">
            <div className="campaign-icon">F</div>
            <div>
              <h3>{item.summary}</h3>
              <span className="badge neutral">
                {item.recommendationType.replaceAll("_", " ")}
              </span>
              <span className={`badge ${item.trigger === "autonomous" ? "warning" : "success"}`}>
                {item.trigger === "autonomous" ? "Autonomous follow-up" : "Manual request"}
              </span>
            </div>
          </div>
          <pre className="advisor-draft">{formatAdvisorDraft(item.draft)}</pre>
          <small>
            Evidence: {item.evidenceEventIds.join(", ")} · Mind: {item.mindId}
          </small>
          <small className="continuity-alias">Continuity: {item.conversationAlias}</small>
          <div className="campaign-footer">
            <strong>Draft only — no action taken</strong>
            <span>
              {item.followUpAt
                ? `Follow up ${new Date(item.followUpAt).toLocaleDateString()}`
                : `Created ${new Date(item.createdAt).toLocaleDateString()}`}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}
function CreatorBriefCard({ creator, onEdit }: { creator: DashboardCreatorProfile | null; onEdit: () => void }) {
  return (
    <article className="panel continuity-card">
      <div className="continuity-card-heading">
        <div>
          <p className="eyebrow">CREATOR CONTEXT</p>
          <h2>Creator brief</h2>
        </div>
        <span className={`badge ${creator?.complete ? "success" : "warning"}`}>{creator?.complete ? "Complete" : "Needs input"}</span>
      </div>
      {!creator ? <p>Loading the durable creator brief…</p> : <>
        <h3>{creator.displayName}</h3>
        <p>{creator.niche}</p>
        <dl className="brief-list">
          <div><dt>Audience</dt><dd>{creator.audience}</dd></div>
          <div><dt>30-day goal</dt><dd>{creator.goal30Day}</dd></div>
          <div><dt>Priority channels</dt><dd>{creator.priorityChannels.join(" · ")}</dd></div>
          <div><dt>Differentiator</dt><dd>{creator.differentiator}</dd></div>
        </dl>
        {!creator.complete && <p className="form-warning">Missing: {creator.missingFields.join(", ")}</p>}
      </>}
      <button className="link-button" type="button" onClick={onEdit}>Edit creator brief</button>
    </article>
  );
}
function MindContinuity({ recommendations }: { recommendations: DashboardAdvisorRecommendation[] | null }) {
  const latest = recommendations?.find((item) => item.conversationAlias);
  const autonomousCount = recommendations?.filter((item) => item.trigger === "autonomous").length ?? 0;
  return (
    <article className="panel continuity-card">
      <div className="continuity-card-heading">
        <div><p className="eyebrow">PERSISTENT MIND</p><h2>Mind continuity</h2></div>
        <span className={`badge ${latest ? "success" : "neutral"}`}>{latest ? "Connected" : "Waiting"}</span>
      </div>
      <p>{latest ? "Each checkpoint reuses the same creator thread and carries forward the last accepted direction." : "Generate the first draft to establish a durable strategy checkpoint."}</p>
      <dl className="brief-list">
        <div><dt>Conversation</dt><dd>{latest?.conversationAlias ?? "Not established"}</dd></div>
        <div><dt>Checkpoints</dt><dd>{recommendations?.length ?? 0}</dd></div>
        <div><dt>Autonomous follow-ups</dt><dd>{autonomousCount}</dd></div>
        <div><dt>Authority</dt><dd>Draft only — steward decides</dd></div>
      </dl>
    </article>
  );
}
function ContinuityProof({
  recommendations,
  state,
  busy,
  onRun,
}: {
  recommendations: DashboardAdvisorRecommendation[] | null;
  state: FollowUpDemoState;
  busy: boolean;
  onRun: () => void;
}) {
  const child = recommendations?.find(
    (item) => item.trigger === "autonomous" && item.parentAuditId,
  );
  const parent = child
    ? recommendations?.find((item) => item.id === child.parentAuditId)
    : recommendations?.find((item) => item.trigger === "manual");
  const hasCheckpoint = recommendations?.some((item) => item.conversationAlias);
  const status =
    state === "making_due"
      ? "Preparing checkpoint"
      : state === "waiting"
        ? "Worker is composing"
        : state === "complete"
          ? "Proof complete"
          : state === "error"
            ? "Needs refresh"
            : child
              ? "Continuity verified"
              : "Ready to prove";
  return (
    <section className="panel continuity-proof" aria-labelledby="continuity-proof-title">
      <div className="continuity-proof-header">
        <div>
          <p className="eyebrow">AUTONOMOUS CONTINUITY PROOF</p>
          <h2 id="continuity-proof-title">One thread, two durable checkpoints</h2>
          <p>
            Make the latest accepted checkpoint due, then watch the worker add a
            bounded, draft-only follow-up on the same Mind conversation.
          </p>
        </div>
        <span className={`badge ${child || state === "complete" ? "success" : state === "error" ? "warning" : "neutral"}`}>
          {status}
        </span>
      </div>
      <div className="continuity-timeline">
        <article className="continuity-node">
          <span className="continuity-index">01</span>
          <div>
            <strong>Manual checkpoint</strong>
            <p>{parent?.summary ?? "Generate advice to establish the parent checkpoint."}</p>
            <small>Depth {parent?.continuityDepth ?? 0}</small>
          </div>
        </article>
        <span className="continuity-connector" aria-hidden="true">→</span>
        <article className={`continuity-node ${child ? "complete" : "pending"}`}>
          <span className="continuity-index">02</span>
          <div>
            <strong>Autonomous follow-up</strong>
            <p>{child?.summary ?? "Waiting for the bounded worker checkpoint."}</p>
            <small>
              {child
                ? `Continues checkpoint ${child.parentAuditId} · depth ${child.continuityDepth}`
                : "Same conversation · no external action"}
            </small>
          </div>
        </article>
      </div>
      <div className="continuity-proof-footer">
        <span>Draft only — no send, tip, reward, spend, or campaign action.</span>
        <button
          className="secondary-button"
          type="button"
          disabled={busy || !hasCheckpoint || state === "making_due" || state === "waiting"}
          onClick={onRun}
        >
          {state === "making_due"
            ? "Preparing…"
            : state === "waiting"
              ? "Waiting for follow-up…"
              : "Run autonomous follow-up demo"}
        </button>
      </div>
    </section>
  );
}
function Audience({ fans }: { fans: DashboardFan[] | null }) {
  return (
    <div className="panel table-panel">
      {fans === null ? (
        <p className="table-loading">Loading audience…</p>
      ) : !fans.length ? (
        <div className="empty">
          <h3>No consented fans yet</h3>
          <p>
            Fans appear here after opting in through a connected creator
            channel.
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Fan</th>
              <th>Consent</th>
              <th>Engagements</th>
              <th>Reward balance</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {fans.map((fan) => (
              <tr key={fan.id}>
                <td>
                  <strong>@{fan.handle}</strong>
                </td>
                <td>
                  <span
                    className={`badge ${fan.personalizationConsent === "active" ? "success" : "warning"}`}
                  >
                    {fan.personalizationConsent}
                  </span>
                </td>
                <td>{fan.engagementCount}</td>
                <td>{money(fan.rewardBalanceMinor)}</td>
                <td>{new Date(fan.joinedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
function Settings({ creator, busy, onSaveCreator, onSaved }: { creator: DashboardCreatorProfile | null; busy: boolean; onSaveCreator: (profile: Omit<DashboardCreatorProfile, "id" | "complete" | "missingFields">) => void; onSaved: () => void }) {
  const saved = JSON.parse(
    localStorage.getItem("fanloom_workspace_settings") ?? "{}",
  );
  return (
    <div className="settings-stack">
      <form className="panel settings-form" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSaveCreator({
          displayName: String(data.get("displayName") ?? ""),
          niche: String(data.get("niche") ?? ""),
          audience: String(data.get("audience") ?? ""),
          priorityChannels: data.getAll("priorityChannels").map(String),
          goal30Day: String(data.get("goal30Day") ?? ""),
          differentiator: String(data.get("differentiator") ?? ""),
        });
      }}>
        <div><h2>Creator brief</h2><p className="muted">This durable context is snapshotted into every Mind checkpoint.</p></div>
        <label>Creator name<input required name="displayName" defaultValue={creator?.displayName ?? ""} /></label>
        <label>Niche<input required name="niche" defaultValue={creator?.niche ?? ""} /></label>
        <label>Audience<textarea required name="audience" defaultValue={creator?.audience ?? ""} /></label>
        <fieldset><legend>Priority channels</legend><div className="channel-checks">
          {["Instagram", "TikTok", "YouTube", "Spotify", "Discord", "Telegram", "X", "Twitch", "Newsletter"].map((channel) => <label className="checkbox-label" key={channel}><input name="priorityChannels" value={channel} type="checkbox" defaultChecked={creator?.priorityChannels.includes(channel)} />{channel}</label>)}
        </div></fieldset>
        <label>30-day goal<textarea required name="goal30Day" defaultValue={creator?.goal30Day ?? ""} /></label>
        <label>Differentiator<textarea required name="differentiator" defaultValue={creator?.differentiator ?? ""} /></label>
        <button className="primary-button" disabled={busy}>Save creator brief</button>
      </form>
      <form className="panel settings-form" onSubmit={(event) => {
          event.preventDefault();
          localStorage.setItem("fanloom_workspace_settings", JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))));
          onSaved();
        }}>
        <div><h2>Workspace defaults</h2><p className="muted">These local defaults preserve fail-closed approval behavior.</p></div>
        <label>Primary channel<select name="channel" defaultValue={saved.channel ?? "discord"}><option value="discord">Discord</option><option value="telegram">Telegram</option><option value="x">X</option></select></label>
        <label>Quiet hours start<input name="quietHours" type="time" defaultValue={saved.quietHours ?? "22:00"} /></label>
        <label>Automatic action limit (USD)<input name="autoApprovalLimit" min="0" type="number" defaultValue={saved.autoApprovalLimit ?? "0"} /></label>
        <label className="checkbox-label"><input name="consentRequired" type="checkbox" defaultChecked /> Require active personalization consent</label>
        <button className="primary-button">Save settings</button>
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
