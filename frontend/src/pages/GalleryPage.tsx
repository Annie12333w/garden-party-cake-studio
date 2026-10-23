import { Link } from "react-router-dom";
import Banner from "../components/Banner";
import { useMenu } from "../menu";
import { money } from "../util";
import { FALLBACK_GALLERY } from "./HomePage";
import type { GalleryItem } from "../types";

export default function GalleryPage() {
  const { menu } = useMenu();
  const all = menu?.gallery?.length ? menu.gallery : FALLBACK_GALLERY;
  const photos = all.filter((g) => g.kind !== "concept");
  const concepts = all.filter((g) => g.kind === "concept");
  return (
    <>
      <Banner image="/photos/table-gingham.jpg" alt="A croquembouche tower and grapes on a blue gingham table" size="slim" align="center" focus="50% 30%">
        <p className="eyebrow">Inspiration</p>
        <h1>The garden gallery</h1>
        <p className="banner-copy">Pick a starting point and make it yours. Every design can change flavor, size and flowers to suit the season.</p>
      </Banner>
      <div className="container section">
        <div className="cake-grid three">
          {photos.map((g) => <Card key={g.slug} g={g} />)}
        </div>
        {concepts.length > 0 && (
          <>
            <header className="page-head center concept-head">
              <p className="eyebrow">Sketchbook</p>
              <h2 className="display">More ideas we would love to make</h2>
              <p className="lead narrow-text">Illustrated designs that have not been photographed yet. Same natural style, ready to make yours.</p>
            </header>
            <div className="cake-grid three">
              {concepts.map((g) => <Card key={g.slug} g={g} />)}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Card({ g }: { g: GalleryItem }) {
  return (
    <article className="cake-card">
      <Link to={`/order?inspo=${encodeURIComponent(g.slug)}`} className="cake-card-image">
        <img src={g.image} alt={`${g.title} cake`} loading="lazy" />
        {g.kind === "concept" && <span className="badge">Illustrated idea</span>}
      </Link>
      <div className="cake-card-body">
        <div className="row-between">
          <h3>{g.title}</h3>
          <span className="price">from {money(g.from_price)}</span>
        </div>
        <p className="muted">{g.description}</p>
        {g.related && g.related.length > 0 && (
          <div className="related">
            <p className="eyebrow">Make it yours</p>
            <ul>{g.related.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}
        <Link to={`/order?inspo=${encodeURIComponent(g.slug)}`} className="text-link">Start from this</Link>
      </div>
    </article>
  );
}
