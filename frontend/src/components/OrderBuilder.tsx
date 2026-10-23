import { useState } from "react";
import { api } from "../api";
import type { Addon, AddonCategory, Availability, InspirationAnalysis, Menu, OrderSpec, Quote } from "../types";
import { errMsg, money, prettyDate, prettyTime, titleCase } from "../util";
import AvailabilityCalendar from "./AvailabilityCalendar";
import { ErrorNote, QuoteBox } from "./common";
import { AuthForm } from "../pages/LoginPage";
import { addonPriceText } from "../pages/MenuPage";

const CATEGORY_LABEL: Record<AddonCategory, string> = {
  florals: "Florals",
  fruit_nuts: "Fruit & nuts",
  finish: "Finishes",
  dietary: "Dietary",
  extras: "Extras",
};
const TIMES = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const OCCASIONS = ["Birthday", "Anniversary", "Bridal shower", "Baby shower", "Engagement", "Graduation", "Dinner party", "Other"];

export default function OrderBuilder({
  menu,
  draft,
  setDraft,
  changed,
  quote,
  availability,
  availLoading,
  analysis,
  imageUrl,
  onUploaded,
  onSubmit,
  submitError,
  loggedIn,
  onReset,
}: {
  menu: Menu | null;
  draft: Partial<OrderSpec>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<OrderSpec>>>;
  changed: string[];
  quote: Quote | null;
  availability: Availability | null;
  availLoading: boolean;
  analysis: InspirationAnalysis | null;
  imageUrl: string | null;
  onUploaded: (id: number, url: string, a: InspirationAnalysis) => void;
  onSubmit: () => Promise<void>;
  submitError: string | null;
  loggedIn: boolean;
  onReset: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  const set = <K extends keyof OrderSpec>(k: K, v: OrderSpec[K] | undefined) => setDraft((d) => ({ ...d, [k]: v }));
  const hl = (f: string) => (changed.includes(f) ? "changed" : "");
  const qty = (code: string) => draft.addons?.find((a) => a.code === code)?.qty ?? 0;
  const setQty = (code: string, q: number) =>
    setDraft((d) => {
      const rest = (d.addons ?? []).filter((a) => a.code !== code);
      return { ...d, addons: q > 0 ? [...rest, { code, qty: q }] : rest };
    });

  const upload = async (file: File) => {
    setUploadError(null);
    if (file.size > 6 * 1024 * 1024) {
      setUploadError("Please choose an image under 6 MB.");
      return;
    }
    setUploading(true);
    try {
      const r = await api.uploadInspiration(file);
      onUploaded(r.image_id, r.url, r.analysis);
    } catch (e) {
      setUploadError(errMsg(e));
    } finally {
      setUploading(false);
    }
  };

  const doSubmit = async () => {
    if (!loggedIn) {
      setShowAuth(true);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit();
    } finally {
      setSubmitting(false);
    }
  };

  const cats = (Object.keys(CATEGORY_LABEL) as AddonCategory[]).filter((c) => menu?.addons.some((a) => a.category === c));

  return (
    <section className="builder" aria-label="Order builder">
      <div className="builder-head row-between">
        <h2 className="display sm">Your order</h2>
        <button className="link-btn small" onClick={onReset}>Start over</button>
      </div>

      <fieldset className={`fs ${hl("occasion")} ${hl("guest_count")} ${hl("recipient_name")}`}>
        <legend>1 · The occasion</legend>
        <div className="grid-2">
          <label>
            Occasion
            <input
              list="occasions"
              value={draft.occasion ?? ""}
              onChange={(e) => set("occasion", e.target.value)}
              placeholder="e.g. 60th birthday"
            />
            <datalist id="occasions">
              {OCCASIONS.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
          <label>
            Guests
            <input
              type="number"
              min={1}
              max={300}
              value={draft.guest_count ?? ""}
              onChange={(e) => set("guest_count", e.target.value ? Number(e.target.value) : null)}
            />
          </label>
        </div>
        <label>
          Who is it for? <span className="muted">(optional)</span>
          <input value={draft.recipient_name ?? ""} onChange={(e) => set("recipient_name", e.target.value)} />
        </label>
      </fieldset>

      <fieldset className={`fs ${hl("size_code")}`}>
        <legend>2 · Size</legend>
        <div className="size-pick">
          {(menu?.sizes ?? []).map((s) => (
            <label key={s.code} className={`size-opt ${draft.size_code === s.code ? "on" : ""}`}>
              <input type="radio" name="size" value={s.code} checked={draft.size_code === s.code} onChange={() => set("size_code", s.code)} />
              <strong>{s.label}</strong>
              <span className="tiny muted">serves about {s.servings}</span>
              <span className="small">from {money(s.base_price)}</span>
            </label>
          ))}
        </div>
        {draft.guest_count && menu ? <SizeHint guests={draft.guest_count} menu={menu} /> : null}
      </fieldset>

      <fieldset className={`fs ${hl("cake_flavor")} ${hl("filling")} ${hl("frosting")}`}>
        <legend>3 · Flavors</legend>
        <div className="grid-3">
          {(["cake", "filling", "frosting"] as const).map((kind) => {
            const key = kind === "cake" ? "cake_flavor" : kind;
            return (
              <label key={kind}>
                {titleCase(kind)}
                <select value={(draft[key] as string) ?? ""} onChange={(e) => set(key, e.target.value)}>
                  <option value="">Choose…</option>
                  {(menu?.flavors[kind] ?? []).map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.name}
                      {f.upcharge ? ` (+${money(f.upcharge)})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className={`fs ${hl("addons")} ${hl("design_notes")}`}>
        <legend>4 · Personal touches</legend>
        <p className="tiny muted">Everything here is natural: real flowers, fruit, nuts and sugar. Add-ons marked ✦ are checked by the studio.</p>
        <div className="addon-pick">
          {cats.map((c) => (
            <div key={c} className="addon-pick-cat">
              <h4>{CATEGORY_LABEL[c]}</h4>
              {menu!.addons
                .filter((a) => a.category === c)
                .map((a) => (
                  <AddonRow key={a.code} a={a} qty={qty(a.code)} setQty={(q) => setQty(a.code, q)} />
                ))}
            </div>
          ))}
        </div>
        <label>
          Design notes
          <textarea
            rows={3}
            value={draft.design_notes ?? ""}
            onChange={(e) => set("design_notes", e.target.value)}
            placeholder="Colours, flowers you love, the feel of the party…"
            maxLength={1500}
          />
        </label>
        
      </fieldset>

      <fieldset className="fs">
        <legend>5 · Inspiration photo <span className="muted">(optional)</span></legend>
        {loggedIn ? (
          <>
            <label className="upload-drop">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
              <span>{uploading ? "Looking at your photo…" : imageUrl ? "Replace photo" : "Upload a cake you love (JPG, PNG, WebP · up to 6 MB)"}</span>
            </label>
            <ErrorNote error={uploadError} />
            {analysis && (
              <div className="analysis">
                {imageUrl && <img src={imageUrl} alt="Your inspiration" />}
                <div>
                  <p className="small">{analysis.summary}</p>
                  <p className="tiny">
                    <span className={`fit fit-${analysis.natural_style_fit}`}>
                      {analysis.natural_style_fit === "great"
                        ? "A natural fit for our style"
                        : analysis.natural_style_fit === "adaptable"
                          ? "We can adapt this to our natural style"
                          : "Not our style, but we'll suggest a natural take"}
                    </span>
                  </p>
                  {analysis.elements.length > 0 && <p className="tiny muted">Spotted: {analysis.elements.join(", ")}</p>}
                  {analysis.concerns.length > 0 && <p className="tiny warn-text">For review: {analysis.concerns.join("; ")}</p>}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="small muted">
            <button className="link-btn" onClick={() => setShowAuth(true)}>Sign in</button> to upload a photo. Our AI will
            pick out the flowers, fruit and finishes and match them to the menu.
          </p>
        )}
      </fieldset>

      <fieldset className={`fs ${hl("allergies")}`}>
        <legend>6 · Allergies</legend>
        <label>
          Allergies
          <input value={draft.allergies ?? ""} onChange={(e) => set("allergies", e.target.value)} placeholder="e.g. tree nuts, or none" />
        </label>
        <p className="tiny muted">Made in a home kitchen that handles nuts, wheat, dairy and eggs. We can't promise allergen-free.</p>
      </fieldset>

      <fieldset className={`fs ${hl("pickup_date")} ${hl("pickup_time")} ${hl("fulfillment")}`}>
        <legend>7 · Date &amp; pickup</legend>
        {!draft.size_code ? (
          <p className="small muted">Choose a size first, then you'll see which dates the studio has time for.</p>
        ) : (
          <AvailabilityCalendar availability={availability} selected={draft.pickup_date} onSelect={(d) => set("pickup_date", d)} loading={availLoading} />
        )}
        <div className="grid-2">
          <label>
            Pickup / delivery time
            <select value={draft.pickup_time ?? ""} onChange={(e) => set("pickup_time", e.target.value || null)}>
              <option value="">Choose…</option>
              {TIMES.map((t) => (
                <option key={t} value={t}>{prettyTime(t)}</option>
              ))}
            </select>
          </label>
          <div className="radio-row" role="radiogroup" aria-label="Pickup or delivery">
            <label className={`pill-opt ${draft.fulfillment !== "delivery" ? "on" : ""}`}>
              <input type="radio" checked={draft.fulfillment !== "delivery"} onChange={() => set("fulfillment", "pickup")} /> Pickup in New Haven
            </label>
            <label className={`pill-opt ${draft.fulfillment === "delivery" ? "on" : ""}`}>
              <input type="radio" checked={draft.fulfillment === "delivery"} onChange={() => set("fulfillment", "delivery")} /> Delivery
            </label>
          </div>
        </div>
        {draft.fulfillment === "delivery" && (
          <div className="grid-2">
            <label>
              Delivery zone
              <select value={draft.delivery_zone ?? ""} onChange={(e) => set("delivery_zone", (e.target.value || null) as OrderSpec["delivery_zone"])}>
                <option value="">Choose…</option>
                <option value="new_haven">New Haven{menu?.policies.delivery_fees?.new_haven !== undefined ? ` (${money(menu.policies.delivery_fees.new_haven)})` : ""}</option>
                <option value="nearby">Within ~15 miles{menu?.policies.delivery_fees?.nearby !== undefined ? ` (${money(menu.policies.delivery_fees.nearby)})` : ""}</option>
                <option value="far">Further (studio will quote)</option>
              </select>
            </label>
            <label>
              Address
              <input value={draft.delivery_address ?? ""} onChange={(e) => set("delivery_address", e.target.value)} autoComplete="street-address" />
            </label>
          </div>
        )}
        {draft.pickup_date && (
          <p className="small">
            Selected: <strong>{prettyDate(draft.pickup_date)}</strong>
            {draft.pickup_time ? ` at ${prettyTime(draft.pickup_time)}` : ""}
          </p>
        )}
      </fieldset>

      <QuoteBox quote={quote} />

      {showAuth && !loggedIn && (
        <div className="inline-auth card">
          <div className="row-between">
            <strong>Sign in to request your date</strong>
            <button className="link-btn small" onClick={() => setShowAuth(false)}>Close</button>
          </div>
          <p className="tiny muted">Your order is saved while you sign in.</p>
          <AuthForm compact onDone={() => setShowAuth(false)} />
        </div>
      )}

      <ErrorNote error={submitError} />
      <button className="btn btn-primary btn-block" onClick={() => void doSubmit()} disabled={submitting}>
        {submitting ? "Sending your request…" : loggedIn ? "Request this date" : "Sign in to request this date"}
      </button>
      <p className="tiny muted center">
        No payment now. The studio reviews your cake first, then sends a deposit invoice (demo only, nothing is charged).
      </p>
    </section>
  );
}

function AddonRow({ a, qty, setQty }: { a: Addon; qty: number; setQty: (q: number) => void }) {
  const multi = a.price_type === "flat" && a.category !== "dietary";
  return (
    <div className={`addon-opt ${qty > 0 ? "on" : ""}`}>
      <label className="addon-main">
        <input type="checkbox" checked={qty > 0} onChange={(e) => setQty(e.target.checked ? 1 : 0)} />
        <span>
          <strong>{a.name}</strong> {a.needs_review && <span title="Checked by the studio">✦</span>}
          <span className="tiny muted block">{a.description}</span>
        </span>
      </label>
      <span className="addon-price small">{addonPriceText(a)}</span>
      {multi && qty > 0 && (
        <span className="qty">
          <button type="button" className="icon-btn" aria-label={`Fewer ${a.name}`} onClick={() => setQty(qty - 1)}>−</button>
          <span aria-live="polite">{qty}</span>
          <button type="button" className="icon-btn" aria-label={`More ${a.name}`} onClick={() => setQty(Math.min(qty + 1, 5))}>+</button>
        </span>
      )}
    </div>
  );
}

function SizeHint({ guests, menu }: { guests: number; menu: Menu }) {
  const fit = [...menu.sizes].sort((x, y) => x.servings - y.servings).find((s) => s.servings >= guests);
  if (!fit) return <p className="tiny muted">For {guests} guests, ask the Order Taker about a larger tiered cake.</p>;
  return <p className="tiny muted">For {guests} guests, the {fit.label} (serves about {fit.servings}) is a good fit.</p>;
}
