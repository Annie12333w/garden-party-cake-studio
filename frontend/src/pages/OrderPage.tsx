import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ORDER_CHAT_KEY, ORDER_DRAFT_KEY, ORDER_OWNER_KEY, useAuth } from "../auth";
import { useMenu } from "../menu";
import ConciergeChat from "../components/ConciergeChat";
import OrderBuilder from "../components/OrderBuilder";
import { SpecSummary } from "../components/common";
import type { Availability, ChatTurn, IdeaCard, InspirationAnalysis, Order, OrderSpec, Quote } from "../types";
import { errMsg, money, prettyDate, prettyTime } from "../util";

const DRAFT_KEY = ORDER_DRAFT_KEY;
const CHAT_KEY = ORDER_CHAT_KEY;

export const EMPTY_DRAFT: Partial<OrderSpec> = {
  occasion: "",
  size_code: "",
  cake_flavor: "",
  filling: "",
  frosting: "",
  addons: [],
  design_notes: "",
  allergies: "",
  pickup_date: null,
  pickup_time: null,
  fulfillment: "pickup",
};

export interface ChatMessage extends ChatTurn {
  ideas?: IdeaCard[];
  suggested_dates?: string[];
  flags?: { code: string; severity: "info" | "warn" | "block"; message: string }[];
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function OrderPage() {
  const { menu } = useMenu();
  const { user, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const [draft, setDraft] = useState<Partial<OrderSpec>>(() => loadJSON(DRAFT_KEY, EMPTY_DRAFT));
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadJSON(CHAT_KEY, [] as ChatMessage[]));
  const [changed, setChanged] = useState<string[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [analysis, setAnalysis] = useState<InspirationAnalysis | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const changedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);
  useEffect(() => {
    sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-30)));
  }, [messages]);

  // The chat belongs to one account. If a different account is now signed in (or the owner signed out),
  // start fresh so nobody sees another customer's conversation, photo or draft.
  const userKey = user ? String(user.id) : "anon";
  useEffect(() => {
    if (authLoading) return;
    const owner = sessionStorage.getItem(ORDER_OWNER_KEY);
    if (owner && owner !== "anon" && owner !== userKey) {
      setDraft(EMPTY_DRAFT);
      setMessages([]);
      setAnalysis(null);
      setImageUrl(null);
      setPlaced(null);
      setQuote(null);
      sessionStorage.removeItem(DRAFT_KEY);
      sessionStorage.removeItem(CHAT_KEY);
    }
    sessionStorage.setItem(ORDER_OWNER_KEY, userKey);
  }, [userKey, authLoading]);

  // Start from a gallery design (?inspo=slug)
  useEffect(() => {
    const slug = params.get("inspo");
    if (!slug || !menu) return;
    const g = menu.gallery.find((x) => x.slug === slug);
    if (!g) return;
    applyDesign({ title: g.title, description: g.description, addon_codes: g.addon_codes, gallery_slug: g.slug });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, menu]);

  // What the last applied idea filled in, so the next idea can replace it (but never the customer's own picks).
  const lastIdea = useRef<Partial<Record<"size_code" | "cake_flavor" | "filling" | "frosting", string>>>({});
  const IDEA_NOTE = /^(Idea: |Inspired by the ")/;

  /** Switch the cake's design to this idea. Replaces decorations, the idea note, and flavors/size that the
   *  previous idea set; keeps the event details (occasion, guests, date, allergies, delivery, message) and
   *  anything the customer chose themselves, plus and anything the customer chose themselves. */
  const applyDesign = (idea: IdeaCard) => {
    const g = idea.gallery_slug ? menu?.gallery.find((x) => x.slug === idea.gallery_slug) : undefined;
    const keepCategories = new Set(["dietary"]);
    const keepCodes = new Set<string>();
    const catOf = (code: string) => menu?.addons.find((a) => a.code === code)?.category;
    // Computed once from the current form (not inside a state updater, which React may run twice).
    const d = draft;
    const kept = (d.addons ?? []).filter((a) => keepCodes.has(a.code) || keepCategories.has(catOf(a.code) ?? ""));
    const next: Partial<OrderSpec> = {
      ...d,
      addons: mergeAddons(kept, idea.addon_codes),
      design_notes: [
        ...(d.design_notes ?? "").split("\n").filter((line) => line.trim() && !IDEA_NOTE.test(line)),
        `Idea: ${idea.title}. ${idea.description}`,
      ].join("\n"),
    };
    const set: typeof lastIdea.current = {};
    for (const f of ["size_code", "cake_flavor", "filling", "frosting"] as const) {
      const fromIdea = g ? g[f] : undefined;
      const current = (d[f] as string | null | undefined) ?? "";
      const ideaOwned = !current || current === lastIdea.current[f];
      if (ideaOwned) {
        next[f] = fromIdea || (current && current === lastIdea.current[f] ? "" : current);
        if (fromIdea) set[f] = fromIdea;
      }
    }
    lastIdea.current = set;
    setDraft(next);
    flash(["addons", "design_notes", "size_code", "cake_flavor", "filling", "frosting"]);
  };

  const flash = (fields: string[]) => {
    setChanged(fields);
    window.clearTimeout(changedTimer.current);
    changedTimer.current = window.setTimeout(() => setChanged([]), 4500);
  };

  // Live quote (debounced). Prices come from the backend price table.
  const quoteKey = JSON.stringify([draft.size_code, draft.cake_flavor, draft.filling, draft.frosting, draft.addons, draft.pickup_date, draft.fulfillment, draft.delivery_zone, draft.dietary]);
  useEffect(() => {
    if (!draft.size_code) {
      setQuote(null);
      return;
    }
    const t = window.setTimeout(() => {
      api.quote(draft).then(setQuote).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  // Capacity-aware availability for this size + add-ons.
  const addonCodes = useMemo(() => (draft.addons ?? []).map((a) => a.code).sort().join(","), [draft.addons]);
  useEffect(() => {
    if (!draft.size_code) {
      setAvailability(null);
      return;
    }
    setAvailLoading(true);
    const t = window.setTimeout(() => {
      api
        .availability(draft.size_code!, addonCodes ? addonCodes.split(",") : [])
        .then(setAvailability)
        .catch(() => setAvailability(null))
        .finally(() => setAvailLoading(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [draft.size_code, addonCodes]);

  const applyIdea = (idea: IdeaCard) => applyDesign(idea);

  const submit = async () => {
    setSubmitError(null);
    const missing = requiredMissing(draft);
    if (missing.length) {
      setSubmitError(`Please add: ${missing.join(", ")}.`);
      return;
    }
    try {
      const order = await api.createOrder(draft as OrderSpec);
      setPlaced(order);
      sessionStorage.removeItem(DRAFT_KEY);
      sessionStorage.removeItem(CHAT_KEY);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setSubmitError(errMsg(e));
    }
  };

  const reset = () => {
    setDraft(EMPTY_DRAFT);
    setMessages([]);
    setAnalysis(null);
    setImageUrl(null);
    setPlaced(null);
    sessionStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem(CHAT_KEY);
  };

  if (placed) {
    return (
      <div className="container narrow section">
        <div className="card confirm-card">
          <p className="eyebrow">Request received · #{placed.id}</p>
          <h1 className="display sm">Thank you, {placed.customer.name.split(" ")[0]}!</h1>
          <p>
            Your date, <strong>{prettyDate(placed.spec.pickup_date)}</strong>
            {placed.spec.pickup_time ? ` at ${prettyTime(placed.spec.pickup_time)}` : ""}, is held while the studio reviews
            your cake{placed.hold_expires_at ? ` (until ${new Date(placed.hold_expires_at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })})` : ""}.
            Once it's accepted, you'll get a deposit invoice for{" "}
            <strong>{money(placed.quote.deposit, true)}</strong> to confirm.
          </p>
          <SpecSummary spec={placed.spec} menu={menu} />
          <p className="small muted">Estimated total {money(placed.quote.total, true)}. The studio sets the final price when it accepts.</p>
          <div className="row gap">
            <Link to="/account" className="btn btn-primary">View my orders</Link>
            <button className="btn btn-ghost" onClick={reset}>Start another cake</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="order-page">
      <div className="container">
        <header className="page-head">
          <p className="eyebrow">Design your cake</p>
          <h1 className="display">Let's dream up your cake</h1>
          <p className="muted">
            Chat with our Order Taker on the left. It fills in the order on the right as you talk, and you can edit
            anything yourself.
          </p>
        </header>
        <div className="order-grid">
          <ConciergeChat
            messages={messages}
            setMessages={setMessages}
            draft={draft}
            onDraft={(d, fields) => {
              setDraft((cur) => ({ ...cur, ...d }));
              if (fields.length) flash(fields);
            }}
            onQuote={(q) => q && setQuote(q)}
            onIdea={applyIdea}
            onPickDate={(date) => {
              setDraft((d) => ({ ...d, pickup_date: date }));
              flash(["pickup_date"]);
            }}
            imageId={draft.inspiration_image_id ?? null}
            menu={menu}
            loggedIn={!!user}
          />
          <OrderBuilder
            menu={menu}
            draft={draft}
            setDraft={setDraft}
            changed={changed}
            quote={quote}
            availability={availability}
            availLoading={availLoading}
            analysis={analysis}
            imageUrl={imageUrl}
            onUploaded={(id, url, a) => {
              setDraft((d) => ({ ...d, inspiration_image_id: id }));
              setAnalysis(a);
              setImageUrl(url);
              if (a.matched_addons?.length) {
                setDraft((d) => ({ ...d, addons: mergeAddons(d.addons ?? [], a.matched_addons) }));
                flash(["addons"]);
              }
            }}
            onSubmit={submit}
            submitError={submitError}
            loggedIn={!!user}
            onReset={reset}
          />
        </div>
      </div>
    </div>
  );
}

export function mergeAddons(cur: { code: string; qty: number }[], codes: string[]) {
  const out = [...cur];
  for (const c of codes) if (!out.some((a) => a.code === c)) out.push({ code: c, qty: 1 });
  return out;
}

export function requiredMissing(d: Partial<OrderSpec>): string[] {
  const m: string[] = [];
  if (!d.occasion?.trim()) m.push("the occasion");
  if (!d.size_code) m.push("a size");
  if (!d.cake_flavor) m.push("a cake flavor");
  if (!d.filling) m.push("a filling");
  if (!d.frosting) m.push("a frosting");
  if (!d.pickup_date) m.push("a pickup date");
  if (!d.pickup_time) m.push("a pickup time");
  if (d.fulfillment === "delivery" && !d.delivery_address?.trim()) m.push("a delivery address");
  return m;
}
