import { Link } from "react-router-dom";
import Banner from "../components/Banner";
import Editorial from "../components/Editorial";
import { useMenu } from "../menu";
import { money } from "../util";
import type { GalleryItem } from "../types";

export const FALLBACK_GALLERY: GalleryItem[] = [
  { id: 1, slug: "meadow", title: "Golden Garden", image: "/photos/golden-garden.jpg", kind: "photo", description: "Swirled buttercream with yellow orchids and chamomile.", tags: ["florals"], addon_codes: [], size_code: "", from_price: 150 },
  { id: 2, slug: "citrus-grove", title: "Citrus Wheel", image: "/photos/citrus-wheel.jpg", kind: "photo", description: "Blood orange, lemon and lime wheels with chamomile.", tags: ["citrus"], addon_codes: [], size_code: "", from_price: 150 },
  { id: 3, slug: "sweetheart", title: "Sweetheart", image: "/photos/sweetheart.jpg", kind: "photo", description: "Ruffled buttercream with strawberry hearts.", tags: ["vintage"], addon_codes: [], size_code: "", from_price: 150 },
  { id: 4, slug: "choux-crown", title: "Chamomile Choux Crown", image: "/photos/choux-crown.jpg", kind: "photo", description: "Caramel cream puffs crowning a berry layer cake.", tags: ["choux"], addon_codes: [], size_code: "", from_price: 150 },
];

/** Borderless, image-led card (HW 4 product-card pattern). */
export function CakeCard({ g }: { g: GalleryItem }) {
  return (
    <Link to={`/order?inspo=${encodeURIComponent(g.slug)}`} className="cake-card">
      <div className="cake-card-image">
        <img src={g.image} alt={`${g.title} cake`} loading="lazy" />
        {g.kind === "concept" && <span className="badge">Illustrated idea</span>}
      </div>
      <div className="cake-card-body">
        <h3>{g.title}</h3>
        <p className="price">from {money(g.from_price)}</p>
        <p className="muted">{g.description}</p>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const { menu } = useMenu();
  const all = menu?.gallery?.length ? menu.gallery : FALLBACK_GALLERY;
  const gallery = all.filter((g) => g.kind !== "concept").slice(0, 4);
  const p = menu?.policies;

  return (
    <>
      <Banner image="/photos/hero-golden-garden.jpg" alt="A swirled buttercream cake with yellow orchids among garden flowers" size="hero" focus="60% 45%">
        <p className="eyebrow">New Haven, Connecticut</p>
        <h1>Cakes for the table, dressed by the garden.</h1>
        <p className="banner-copy">
          Special-occasion cakes finished with fresh flowers, ripe fruit and a dusting of icing sugar. Buttercream
          only, never fondant. Made by hand, to order, in a small home studio.
        </p>
        <div className="banner-actions">
          <Link to="/order" className="btn btn-light">Start your cake</Link>
          <Link to="/menu" className="text-link light">See pricing</Link>
        </div>
      </Banner>

      <section className="intro container narrow center">
        <p className="eyebrow">Fruits · florals · foliage</p>
        <p className="intro-copy">
          Inspired by long tables, Martha-style entertaining and whatever is in season. No plastic toppers, no
          fondant, no airbrushed colours, just what grows, finished with care.
        </p>
        <p className="small muted">
          Custom cakes from {money(p?.min_price ?? 150)} · at least {p?.min_lead_days ?? 7} days' notice ·{" "}
          {Math.round((p?.deposit_pct ?? 0.5) * 100)}% deposit holds your date
        </p>
      </section>

      <section className="section container">
        <div className="section-head">
          <h2 className="display">From the studio</h2>
          <Link to="/gallery" className="text-link">View the gallery</Link>
        </div>
        <div className="cake-grid">
          {gallery.map((g) => <CakeCard key={g.slug} g={g} />)}
        </div>
      </section>

      <Editorial image="/photos/garden-florals.jpg" alt="Nasturtiums and yellow orchids in an amber vase in the window light" focus="50% 40%">
        <p className="eyebrow">Fresh from the garden</p>
        <h2 className="display">Flowers you could pick yourself</h2>
        <p>
          Nasturtiums, chamomile, orchids and herbs, chosen for the season and placed food-safely. Every cake is
          designed around what is blooming the week it is made.
        </p>
        <Link to="/order" className="btn btn-primary">Dream one up</Link>
      </Editorial>

      <Banner image="/photos/table-candlelit.jpg" alt="A vintage piped cake and a sliced strawberry-heart cake by candlelight" size="large" align="center" focus="50% 55%">
        <p className="eyebrow">Anniversaries · Valentine's · Dinner parties</p>
        <h2>Made for candlelight</h2>
        <p className="banner-copy">Vintage Lambeth piping, fresh strawberry hearts and a raspberry jam center.</p>
        <div className="banner-actions">
          <Link to="/order?inspo=sweetheart" className="btn btn-light">Start from Sweetheart</Link>
        </div>
      </Banner>

      <Editorial image="/photos/croquembouche.jpg" alt="A spun-caramel croquembouche tower with chamomile" reverse focus="50% 35%">
        <p className="eyebrow">Showstoppers</p>
        <h2 className="display">Choux crowns &amp; croquembouche</h2>
        <p>
          Caramel-glazed cream puffs, spun sugar and chamomile: on top of a layer cake, or stacked into a tower beside
          it. The studio reviews every tower for weather and travel.
        </p>
        <Link to="/gallery" className="text-link">See the showstoppers</Link>
      </Editorial>

      <section className="section container">
        <div className="table-strip">
          <figure><img src="/photos/table-garden.jpg" alt="A sunlit garden-party table with cakes, tarts and nasturtiums" loading="lazy" /><figcaption>Sunlit garden party</figcaption></figure>
          <figure><img src="/photos/table-gingham.jpg" alt="A croquembouche and grapes on a blue gingham picnic table" loading="lazy" /><figcaption>Blue gingham picnic</figcaption></figure>
          <figure><img src="/photos/dessert-table.jpg" alt="A citrus-wheel cake with blood-orange and lemon-chamomile tarts" loading="lazy" /><figcaption>Garden dessert table</figcaption></figure>
        </div>
        <p className="small muted center">Every photo here is a real table from the studio.</p>
      </section>

      <section className="section tint">
        <div className="container">
          <h2 className="display center">How ordering works</h2>
          <ol className="how-steps">
            <li>
              <span className="how-num">01</span>
              <h4>Dream it up</h4>
              <p>Tell our Order Taker about the occasion. Not sure what you want? It suggests seasonal, natural ideas and prices them as you go.</p>
            </li>
            <li>
              <span className="how-num">02</span>
              <h4>Request a date</h4>
              <p>You only see dates the studio really has time for. Your date is held for {p?.hold_hours ?? 48} hours while it's reviewed.</p>
            </li>
            <li>
              <span className="how-num">03</span>
              <h4>Owner review</h4>
              <p>Every cake is reviewed by hand before it's accepted, so the price and design are ones we can make well.</p>
            </li>
            <li>
              <span className="how-num">04</span>
              <h4>Deposit holds it</h4>
              <p>A {Math.round((p?.deposit_pct ?? 0.5) * 100)}% non-refundable deposit confirms your date. The balance is due at pickup.</p>
            </li>
            <li>
              <span className="how-num">05</span>
              <h4>Bake &amp; pick up</h4>
              <p>Baked fresh in the days before your event. Pick up in New Haven, or have it delivered.</p>
            </li>
          </ol>
          <div className="center">
            <Link to="/order" className="btn btn-primary">Begin with a conversation</Link>
          </div>
        </div>
      </section>

      <section className="value-row container">
        <div><h4>Buttercream only</h4><p className="small muted">Swiss meringue, cream cheese or mascarpone. Never fondant.</p></div>
        <div><h4>Grown, not printed</h4><p className="small muted">Real flowers, fruit, herbs and nuts, chosen for the season.</p></div>
        <div><h4>Reviewed by hand</h4><p className="small muted">Annie confirms every design, date and price before you pay a deposit.</p></div>
      </section>
    </>
  );
}
