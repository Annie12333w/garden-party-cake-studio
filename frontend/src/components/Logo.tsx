/**
 * Garden Party Cake Studio logo, based on the owner's original badge: deep-green circle, cream hand-script
 * "Garden Party", spaced "CAKE STUDIO" on a fine flourish. The SVGs in /public/brand have the lettering
 * converted to shapes, so they look the same everywhere (site, favicon, report, slides).
 */

/** Horizontal script wordmark (header, staff sidebar). Use `light` on dark backgrounds. */
export function Wordmark({ height = 52, light = false }: { height?: number; light?: boolean }) {
  return (
    <img
      src={light ? "/brand/logo-wordmark-light.svg" : "/brand/logo-wordmark.svg"}
      alt="Garden Party Cake Studio"
      className="wordmark-img"
      style={{ height, width: "auto" }}
    />
  );
}

/** Round badge (footer, login, report). `botanical` adds the leaf-and-blossom sprig. */
export function LogoBadge({ size = 96, botanical = true, onMoss = false }: { size?: number; botanical?: boolean; onMoss?: boolean }) {
  // onMoss: the badge circle matches the moss header/footer color (#2f3a26) exactly.
  const src = onMoss ? "/brand/logo-badge-botanical-footer.svg"
    : botanical ? "/brand/logo-badge-botanical.svg" : "/brand/logo-badge.svg";
  return (
    <img
      src={src}
      alt="Garden Party Cake Studio"
      className="logo-badge"
      style={{ width: size, height: size }}
    />
  );
}

/** Small round mark (favicon-style), kept for places that used the old icon. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return <img src="/brand/favicon.svg" alt="" aria-hidden="true" style={{ width: size, height: size }} />;
}
