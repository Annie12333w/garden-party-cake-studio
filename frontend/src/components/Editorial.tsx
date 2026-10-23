import type { ReactNode } from "react";

/** Image-and-text split section (HW 4 pattern); the photo is cropped to fit, never stretched. */
export default function Editorial({
  image,
  alt,
  focus = "center",
  reverse = false,
  children,
}: {
  image: string;
  alt: string;
  focus?: string;
  reverse?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`editorial${reverse ? " editorial-reverse" : ""}`}>
      <div className="editorial-image">
        <img src={image} alt={alt} loading="lazy" style={{ objectPosition: focus }} />
      </div>
      <div className="editorial-text">{children}</div>
    </section>
  );
}
