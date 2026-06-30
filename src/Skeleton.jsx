import { useEffect } from "react";
import { t } from "./tokens.js";

// Calm skeleton placeholder. A slow (2s) shimmer sweeps a subtle highlight
// across a tinted block. The shimmer is disabled under
// prefers-reduced-motion: reduce — those users see a static tint instead.

const STYLE_ID = "spectrum-skeleton-style";
const SHIMMER_CSS = `
@keyframes spectrum-skeleton-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.spectrum-skeleton {
  background-color: ${t.surfaceAlt};
  background-image: linear-gradient(
    90deg,
    ${t.surfaceAlt} 0%,
    ${t.green50} 50%,
    ${t.surfaceAlt} 100%
  );
  background-size: 200% 100%;
  animation: spectrum-skeleton-shimmer 2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .spectrum-skeleton {
    background-image: none;
    animation: none;
  }
}
`;

function ensureStyleInjected() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = SHIMMER_CSS;
  document.head.appendChild(el);
}

export default function Skeleton({ width = "100%", height = 16, radius = 8, style }) {
  useEffect(() => {
    ensureStyleInjected();
  }, []);

  return (
    <div
      aria-hidden="true"
      className="spectrum-skeleton"
      style={{
        width,
        height,
        borderRadius: radius,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
