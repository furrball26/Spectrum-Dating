// SectionRule — D-8: the tile motif's one confident moment per surface. A short
// spectrum ramp underline that sits beneath a screen's serif <h1> ("Your
// profile" / "Your matches" / "Likes" …), turning the 4px corner strip into a
// deliberate brand rule that also carries the ramp's WARM clay/sand end onto
// every screen (D-6). Decorative only (aria-hidden).
//
// A-2 nit #1: this now renders a CONTINUOUS literal-hex ramp instead of the
// tiled SpectrumMark. The mark reads its tiles from the `--mark-*` CSS vars,
// which the `trans` identity theme repaints to the trans-flag palette — there,
// `--mark-3`/`--mark-4` are WHITE and the two middle tiles vanished against
// white surfaces, breaking the rule. A theme-constant literal ramp (mirroring
// ProfileScreen's COMPLETENESS_RAMP approach) stays green→sand in EVERY theme,
// and a seamless gradient can't drop a tile on any surface. Static + flat, so
// it's reduced-sensory-safe.

// Theme-constant brand ramp (literal hex — never the identity-flag palette).
const RAMP = ["#5E9459", "#539490", "#5E9C93", "#6FA39A", "#C9A875", "#E7D9C4"];

export default function SectionRule({ height = 7, width = 48, style }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "block",
        height,
        width,
        borderRadius: 2,
        marginTop: 12,
        background: `linear-gradient(90deg, ${RAMP.join(", ")})`,
        ...style,
      }}
    />
  );
}
