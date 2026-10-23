import Banner from "../components/Banner";
import { Link } from "react-router-dom";
import { useMenu } from "../menu";
import { ErrorNote } from "../components/common";
import { money, weekdayName } from "../util";
import type { Addon, AddonCategory, Flavor } from "../types";

const CATEGORY_LABEL: Record<AddonCategory, string> = {
  florals: "Florals",
  fruit_nuts: "Fruit & nuts",
  finish: "Finishes",
  dietary: "Dietary",
  extras: "Extras",
};

export function addonPriceText(a: Addon): string {
  if (!a.price) return "included";
  switch (a.price_type) {
    case "per_tier":
      return `${money(a.price)} per tier`;
    case "per_serving":
      return `${money(a.price, true)} per serving`;
    case "percent":
      return `+${Math.round(a.price * (a.price > 1 ? 1 : 100))}%`;
    default:
      return money(a.price);
  }
}

function FlavorList({ title, items }: { title: string; items: Flavor[] }) {
  return (
    <div className="flavor-col">
      <h3>{title}</h3>
      <ul className="plain flavor-list">
        {items.map((f) => (
          <li key={f.code}>
            <div className="row-between">
              <strong>{f.name}</strong>
              <span className="muted small">{f.upcharge ? `+${money(f.upcharge)}` : "included"}</span>
            </div>
            <span className="small muted">{f.description}</span>
            {f.allergens.length > 0 && <span className="tiny allergen">Contains: {f.allergens.map((a) => a.replace(/_/g, " ")).join(", ")}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MenuPage() {
  const { menu, error } = useMenu();
  const p = menu?.policies;
  const cats = (Object.keys(CATEGORY_LABEL) as AddonCategory[]).filter((c) => menu?.addons.some((a) => a.category === c));

  return (
    <>
    <Banner image="/photos/dessert-table.jpg" alt="A citrus-wheel cake with blood-orange and lemon-chamomile tarts" size="slim" align="center" focus="50% 45%">
      <p className="eyebrow">Menu &amp; pricing</p>
      <h1>Made to order, priced honestly</h1>
      <p className="banner-copy">
        Every cake starts from its size and grows with the work it needs. The Order Taker uses this exact price
        table, and the studio confirms the final price before anything is charged.
      </p>
    </Banner>
    <div className="container section">
      <ErrorNote error={error} />

      <div className="pricing-rule card">
        <div className="rule-formula">
          <span>price</span> = <strong>size</strong> (from {money(Math.min(...(menu?.sizes ?? []).map((s) => s.base_price), p?.min_price ?? 150))})
          {" "}+ premium flavors + add-ons
        </div>
        <p className="small muted">
          Short notice (under {p?.rush_days ?? 14} days) adds {Math.round((p?.rush_pct ?? 0.15) * 100)}%. Delivery is priced by zone.
        </p>
      </div>

      <section className="section-sm">
        <h2 className="display sm">Sizes</h2>
        <div className="size-grid">
          {(menu?.sizes ?? []).map((s) => (
            <div key={s.code} className="size-card">
              <div className="size-tiers" aria-hidden="true">
                {Array.from({ length: s.tiers }).map((_, i) => (
                  <span key={i} style={{ width: `${70 - i * 18}%` }} />
                ))}
              </div>
              <h3>{s.label}</h3>
              <p className="muted small">Serves about {s.servings}</p>
              <p className="price">from {money(s.base_price)}</p>
              <p className="tiny muted">{s.description}</p>
            </div>
          ))}
        </div>
      </section>

      {menu && (
        <section className="section-sm">
          <h2 className="display sm">Flavors</h2>
          <div className="flavor-grid">
            <FlavorList title="Cake" items={menu.flavors.cake} />
            <FlavorList title="Filling" items={menu.flavors.filling} />
            <FlavorList title="Frosting" items={menu.flavors.frosting} />
          </div>
        </section>
      )}

      <section className="section-sm">
        <h2 className="display sm">Personal touches</h2>
        <div className="addon-cats">
          {cats.map((c) => (
            <div key={c} className="addon-cat">
              <h3>{CATEGORY_LABEL[c]}</h3>
              <ul className="plain">
                {menu!.addons
                  .filter((a) => a.category === c)
                  .map((a) => (
                    <li key={a.code} className="addon-row">
                      <div className="row-between">
                        <strong>{a.name}</strong>
                        <span className="price-sm">{addonPriceText(a)}</span>
                      </div>
                      <span className="small muted">{a.description}</span>
                      {a.needs_review && <span className="tiny chip">reviewed by the studio</span>}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="section-sm policies">
        <h2 className="display sm">Good to know</h2>
        <div className="policy-grid">
          <div>
            <h4>Deposit</h4>
            <p>A {Math.round((p?.deposit_pct ?? 0.5) * 100)}% non-refundable deposit secures your date once the studio accepts your order. The balance is due at pickup.</p>
          </div>
          <div>
            <h4>Notice</h4>
            <p>At least {p?.min_lead_days ?? 7} days for every order. Popular weekends fill weeks ahead. Your requested date is held for {p?.hold_hours ?? 48} hours during review.</p>
          </div>
          <div>
            <h4>Style</h4>
            <p>{p?.style_note ?? "Natural buttercream cakes finished with fresh flowers, fruit, nuts and icing sugar. We don't do fondant or artificial-looking designs."}</p>
          </div>
          <div>
            <h4>Pickup days</h4>
            <p>{p ? p.pickup_weekdays.map(weekdayName).join(", ") : "Wed – Sun"}. Delivery within New Haven {p?.delivery_fees?.new_haven !== undefined ? money(p.delivery_fees.new_haven) : ""}.</p>
          </div>
        </div>
      </section>

      <div className="center section-sm">
        <Link to="/order" className="btn btn-primary">Design your cake</Link>
      </div>
    </div>
    </>
  );
}
