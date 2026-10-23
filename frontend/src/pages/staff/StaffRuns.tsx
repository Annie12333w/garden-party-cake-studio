import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api";
import { AGENT_META, Card, ErrorNote, useRunWatcher } from "../../components/common";
import RunLog from "../../components/RunLog";
import { prettyDateTime, usd4, useLoad } from "../../util";

const TEAM = ["order_taker", "recipe", "inventory", "cash", "task"];

export function TeamDiagram() {
  const boss = AGENT_META.boss;
  return (
    <div className="team-diagram" aria-label="Agent team: the Boss directs five specialists">
      <div className="team-boss">
        <span className="ta" style={{ background: boss.color }}>{boss.emoji}</span>
        <strong>{boss.label}</strong>
        <span className="tiny muted">{boss.role}</span>
      </div>
      <svg className="team-lines" viewBox="0 0 500 40" preserveAspectRatio="none" aria-hidden="true">
        {TEAM.map((_, i) => (
          <line key={i} x1="250" y1="0" x2={50 + i * 100} y2="40" />
        ))}
      </svg>
      <div className="team-row">
        {TEAM.map((k) => {
          const m = AGENT_META[k];
          return (
            <div key={k} className="team-member">
              <span className="ta" style={{ background: m.color }}>{m.emoji}</span>
              <strong className="small">{m.label}</strong>
              <span className="tiny muted">{m.role}</span>
            </div>
          );
        })}
      </div>
      <p className="tiny muted center">All tools come from the bakery MCP server. Each agent may only use its own tools, and money and approvals stay with you.</p>
    </div>
  );
}

export default function StaffRuns() {
  const { runId } = useParams();
  const runs = useLoad(() => api.runs(), []);
  const runner = useRunWatcher(() => void runs.reload());

  useEffect(() => {
    if (runId) void runner.watch(runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Agent runs</h1>
      </header>
      <Card title="The team">
        <TeamDiagram />
      </Card>
      <ErrorNote error={runs.error || runner.error} />
      <div className="runs-split">
        <div className="run-list">
          {(runs.data ?? []).length === 0 && !runs.loading && <p className="muted small">No runs yet. Try "Plan my week" or "Run AI review".</p>}
          {(runs.data ?? []).map((r) => (
            <Link key={r.run_id} to={`/staff/runs/${r.run_id}`} className={`run-li ${runId === r.run_id ? "on" : ""}`}>
              <div className="row-between">
                <strong className="small">{r.kind === "plan_week" ? `Plan week ${r.week_start ?? ""}` : `Review order #${r.order_id}`}</strong>
                <span className={`run-status rs-${r.status}`}>{r.status}</span>
              </div>
              <span className="tiny muted">
                {prettyDateTime(r.started_at)} · {r.usage.llm_calls} calls · {usd4(r.usage.cost_usd)}
              </span>
            </Link>
          ))}
        </div>
        <div>
          {runner.run ? (
            <Card title={runner.run.kind === "plan_week" ? "Weekly planning run" : `Order review #${runner.run.order_id ?? ""}`}>
              <RunLog run={runner.run} />
            </Card>
          ) : (
            <div className="card empty-card"><p className="muted">Pick a run to see the play-by-play.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
