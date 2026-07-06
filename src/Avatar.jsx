import { useState, useEffect } from "react";
import { t } from "./tokens.js";

// Shared default avatar. When there's no photo we render a calm, deterministic
// two-tone monogram — same seed always maps to the same colours, so identity
// stays stable across screens. The visual is aria-hidden: the surrounding
// context already names the person.

// D-7 — the monogram two-tone is now derived from the brand spectrum ramp IN
// RAMP ORDER (green → teal → deep-teal → soft-teal → clay → sand): each avatar
// uses an ADJACENT forward step along the ramp, so the whole set reads as one
// coherent spectrum rather than random gradients. Literal hex (not the --mark-*
// vars) on purpose — avatars stay brand-green in every theme, including the
// identity themes where the mark vars become flag colours.
const RAMP = ["#5E9459", "#4F8A8B", "#3E6660", "#6FA39A", "#C9A875", "#E7D9C4"];

// Small, stable string hash (FNV-ish). Returns a non-negative integer.
function hashSeed(seed) {
  const s = String(seed || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h);
}

// Relative luminance (sRGB) of a #rrggbb — used to pick a monogram ink colour
// that stays legible on both the dark (green/teal) and the light (clay/sand)
// end of the ramp.
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// `alt` — optional override for the img alt text. When a user has supplied a
// photo description ("Me hiking with my dog"), pass it here so SR users get
// that richer context instead of the generic "Photo of Name" fallback.
export default function Avatar({ name, userId, photoUrl, alt, size = 56, style }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  // B21 — a broken/unreachable photo URL must NOT leave the alt text ("Photo of
  // X") sitting inside the circle; on load error we flip to a failed state and
  // fall through to the deterministic monogram fallback below. `useState` +
  // `useEffect` are declared BEFORE any early return (React #310 hooks gate).
  const [imgFailed, setImgFailed] = useState(false);
  // Reset the failure flag when the source changes (same Avatar instance reused
  // for a different person / a corrected URL).
  useEffect(() => { setImgFailed(false); }, [photoUrl]);

  if (photoUrl && !imgFailed) {
    // A real photo is informative (not decorative) — give it a meaningful alt so
    // screen-reader users know there's a photo and whose it is.
    const imgAlt = alt || (name ? `Photo of ${name}` : "Profile photo");
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
          alt={imgAlt}
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>
    );
  }

  const seed = userId || name || "";
  const h = hashSeed(seed);
  // Adjacent forward step along the ramp (5 possible pairs, all harmonious).
  const start = h % (RAMP.length - 1);
  const from = RAMP[start];
  const to = RAMP[start + 1];
  // Legible ink: white on the dark end, brand green-900 on the light clay/sand
  // end (white would fail contrast there).
  const ink = (luminance(from) + luminance(to)) / 2 > 0.42 ? "#24332D" : "#FFFFFF";
  // Stable, collision-free gradient id for the ramp-arc signature.
  const gradId = `spectrum-avatar-${h}`;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        overflow: "hidden",
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
          color: ink,
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        {initial}
      </span>
      {/* D-7 — the quiet spectrum signature: a soft ramp arc hugging the base of
          the ring so a Spectrum monogram is recognisable at a glance. Static,
          flat, no motion; scales cleanly with the avatar (viewBox units). */}
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#5E9459" />
            <stop offset="0.4" stopColor="#4F8A8B" />
            <stop offset="0.7" stopColor="#6FA39A" />
            <stop offset="1" stopColor="#E7D9C4" />
          </linearGradient>
        </defs>
        <path
          d="M 27 82.8 A 40 40 0 0 0 73 82.8"
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={5}
          strokeLinecap="round"
          opacity={ink === "#FFFFFF" ? 0.92 : 0.7}
        />
      </svg>
    </div>
  );
}
