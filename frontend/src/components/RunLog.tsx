import type { RunDetail } from "../types";
import { prettyDateTime, usd4 } from "../util";
import { agentMeta } from "./common";

export default function RunLog({ run, compact = false }: { run: RunDetail; compact?: boolean }) {
  const events = compact ? run.events.slice(-14) : run.events;
  return (
    <div className={`run-log ${compact ? "compact" : ""}`}>
      <div className="run-meta tiny muted">
        <span className={`run-status rs-${run.status}`}>{run.status === "running" ? "running…" : run.status}</span>
        <span>{run.usage.llm_calls} LLM calls</span>
        <span>{(run.usage.input_tokens + run.usage.output_tokens).toLocaleString()} tokens</span>
        <span>{run.usage.cached_tokens.toLocaleString()} cached</span>
        <span>{usd4(run.usage.cost_usd)}</span>
      </div>
      <ol className="events">
        {events.map((e) => {
          const m = agentMeta(e.agent);
          return (
            <li key={e.seq} className={`ev ev-${e.event}`}>
              <span className="ev-avatar" style={{ background: m.color }} title={m.label} aria-hidden="true">
                {m.emoji}
              </span>
              <div>
                <span className="tiny muted">
                  {m.label}
                  {e.to_agent ? ` → ${agentMeta(e.to_agent).label}` : ""}
                  {e.tool ? ` · ${e.tool}` : ""} · {prettyDateTime(e.ts)}
                  {e.cost_usd ? ` · ${usd4(e.cost_usd)}` : ""}
                </span>
                <p className="small prewrap">{e.text}</p>
              </div>
            </li>
          );
        })}
        {run.status === "running" && (
          <li className="ev ev-pending">
            <span className="ev-avatar pulse" aria-hidden="true">…</span>
            <p className="small muted">working…</p>
          </li>
        )}
      </ol>
      {run.summary && run.status !== "running" && (
        <div className="run-summary">
          <strong className="small">Summary</strong>
          <p className="small prewrap">{run.summary}</p>
        </div>
      )}
    </div>
  );
}
