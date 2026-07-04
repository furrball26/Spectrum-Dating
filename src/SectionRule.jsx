import SpectrumMark from "./SpectrumMark.jsx";

// SectionRule — D-8: the tile motif's one confident moment per surface. A short
// spectrum ramp underline that sits beneath a screen's serif <h1> ("Your
// profile" / "Your matches" / "Likes" …), turning the 4px corner strip into a
// deliberate brand rule. It's the sanctioned brand mark (SpectrumMark), so it
// also carries the ramp's WARM clay/sand tiles onto every screen (D-6) and is
// reduced-sensory-safe (the same static primitive used as the illustration
// fallback). Decorative only — aria-hidden lives inside SpectrumMark.
export default function SectionRule({ height = 7, style }) {
  return (
    <SpectrumMark
      height={height}
      radius={2}
      style={{ display: "block", marginTop: 12, ...style }}
    />
  );
}
