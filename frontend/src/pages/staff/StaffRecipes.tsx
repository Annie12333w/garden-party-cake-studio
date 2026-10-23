import { useState } from "react";
import { api } from "../../api";
import { ErrorNote } from "../../components/common";
import type { Recipe } from "../../types";
import { errMsg, num, titleCase, useLoad } from "../../util";

export default function StaffRecipes() {
  const recipes = useLoad(() => api.recipes(), []);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | Recipe["kind"]>("all");

  const approve = async (id: number) => {
    setError(null);
    try {
      const r = await api.approveRecipe(id);
      recipes.setData((cur) => (cur ?? []).map((x) => (x.id === r.id ? r : x)));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const rows = (recipes.data ?? []).filter((r) => kind === "all" || r.kind === kind);
  const pending = (recipes.data ?? []).filter((r) => r.status === "needs_review").length;

  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Recipe library</h1>
        <div className="filter-tabs small">
          {(["all", "cake", "filling", "frosting"] as const).map((k) => (
            <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
              {k === "all" ? "All" : titleCase(k)}
            </button>
          ))}
        </div>
      </header>
      <p className="small muted">
        The Recipe Collector uses your own recipes first. New ones it finds online are well-reviewed, but they wait here as
        <strong> needs review</strong> until you approve them{pending ? `. ${pending} waiting` : ""}.
      </p>
      <ErrorNote error={error || recipes.error} />
      <div className="recipe-grid">
        {rows.map((r) => (
          <article key={r.id} className={`card recipe-card ${r.status === "needs_review" ? "needs-review" : ""}`}>
            <div className="row-between">
              <div>
                <p className="eyebrow">{r.kind} · {r.source === "owner" ? "your recipe" : r.source === "web" ? "found online" : "sample"}</p>
                <h3>{r.name}</h3>
              </div>
              {r.status === "needs_review" ? (
                <button className="btn btn-sm btn-primary" onClick={() => void approve(r.id)}>Approve</button>
              ) : (
                <span className="chip tiny ok">approved</span>
              )}
            </div>
            <p className="tiny muted">
              {r.yield_note} · {r.active_minutes} min hands-on · keeps {r.shelf_life_days} days{r.freezer_ok ? " · freezes well" : ""}
              {r.rating ? ` · ★ ${r.rating}${r.review_count ? ` (${num(r.review_count)} reviews)` : ""}` : ""}
            </p>
            {r.source_url && (
              <p className="tiny">
                <a href={r.source_url} target="_blank" rel="noreferrer noopener">Source ↗</a>
              </p>
            )}
            <button className="link-btn small" onClick={() => setOpen(open === r.id ? null : r.id)}>
              {open === r.id ? "Hide recipe" : "Show recipe"}
            </button>
            {open === r.id && (
              <div className="recipe-body">
                <h4>Ingredients</h4>
                <ul className="small">
                  {r.ingredients.map((i, k) => (
                    <li key={k}>{num(i.qty)} {i.unit} {i.item}</li>
                  ))}
                </ul>
                {r.steps.length > 0 && (
                  <>
                    <h4>Method</h4>
                    <ol className="small">
                      {r.steps.map((s, k) => (
                        <li key={k}>{s}</li>
                      ))}
                    </ol>
                  </>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
