import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { ErrorNote } from "../../components/common";
import { prettyDateTime, titleCase, useLoad } from "../../util";

export default function StaffDrafts() {
  const { data, error, loading } = useLoad(() => api.drafts(), []);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Email drafts</h1>
      </header>
      <p className="small muted">
        The agents write drafts only. Nothing is ever sent automatically. <strong>Open in Gmail</strong> fills in a new message
        in your studio Gmail; you read it, edit it and press send yourself.
      </p>
      <ErrorNote error={error} />
      {loading && !data && <p className="muted small">Loading…</p>}
      {data?.length === 0 && <p className="muted small">No drafts yet.</p>}
      <div className="draft-list">
        {(data ?? []).map((d) => (
          <article key={d.id} className="card draft">
            <div className="row-between wrap">
              <div>
                <p className="eyebrow">{titleCase(d.kind)} · {prettyDateTime(d.created_at)}</p>
                <h3 className="small-h">{d.subject}</h3>
                <p className="tiny muted">
                  To {d.to}
                  {d.order_id ? <> · <Link to={`/staff/orders/${d.order_id}`}>order #{d.order_id}</Link></> : null}
                </p>
              </div>
              <div className="row gap">
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(open === d.id ? null : d.id)}>
                  {open === d.id ? "Hide" : "Read"}
                </button>
                <a className="btn btn-primary btn-sm" href={d.gmail_link} target="_blank" rel="noreferrer">Open in Gmail</a>
              </div>
            </div>
            {open === d.id && <pre className="draft-body">{d.body}</pre>}
          </article>
        ))}
      </div>
    </div>
  );
}
