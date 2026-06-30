import { t } from "./tokens.js";

// Shared default avatar. When there's no photo we render a calm, deterministic
// two-tone diagonal gradient with the person's initial — same seed always maps
// to the same gradient, so identity stays stable across screens. The visual is
// aria-hidden: the surrounding context already names the person.

// Calm brand gradient pairs (greens → teals → sand/clay). Literal hex so they
// look identical in both light and dim themes.
const GRADIENTS = [
  ["#5E9459", "#4F8A8B"],
  ["#3E6660", "#6FA39A"],
  ["#4F8A8B", "#7FB0A7"],
  ["#6FA39A", "#C9A875"],
  ["#5B8A82", "#4A7570"],
  ["#7FB0A7", "#5E9459"],
];

// Small, stable string hash (FNV-ish). Returns a non-negative integer.
function hashSeed(seed) {
  const s = String(seed || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h);
}

export default function Avatar({ name, userId, photoUrl, size = 56, style }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";

  if (photoUrl) {
    // A real photo is informative (not decorative) — give it a meaningful alt so
    // screen-reader users know there's a photo and whose it is.
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
          background: t.surfaceAlt,
          ...style,
        }}
      >
        <img
          src={photoUrl}
          alt={name ? `Photo of ${name}` : "Profile photo"}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>
    );
  }

  const seed = userId || name || "";
  const [from, to] = GRADIENTS[hashSeed(seed) % GRADIENTS.length];

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: t.serif,
          fontSize: Math.round(size * 0.42),
          fontWeight: 700,
          color: "#fff",
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        {initial}
      </span>
    </div>
  );
}
