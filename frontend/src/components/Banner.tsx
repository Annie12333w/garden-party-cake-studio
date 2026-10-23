import type { ReactNode } from "react";

/**
 * Full-width photo banner (same pattern as HW 4). The photo keeps its proportions: it is cropped to fill the
 * frame with object-fit: cover, never stretched. `focus` picks which part of the photo stays in view.
 */
export default function Banner({
  image,
  alt,
  focus = "center",
  size = "large",
  align = "left",
  children,
}: {
  image: string;
  alt: string;
  focus?: string;
  size?: "hero" | "large" | "slim";
  align?: "left" | "center";
  children?: ReactNode;
}) {
  return (
    <section className={`banner banner-${size} banner-${align}`}>
      <img src={image} alt={alt} style={{ objectPosition: focus }} />
      {children && <div className="banner-content">{children}</div>}
    </section>
  );
}
