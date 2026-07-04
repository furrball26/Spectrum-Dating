import { useState, useEffect, useRef } from "react";
import { t } from "./tokens.js";

// PROD-6 — viewer-side photo gallery. Renders a member's approved photos[]
// (each { url, description, isPrimary }, already ordered primary-first by the
// backend) as a calm, tappable carousel.
//
// Calm-by-design:
//  - NO autoplay / auto-advance / timers. The viewer moves it, nothing else.
//  - prefers-reduced-motion → no fade/transition at all (instant swap).
//  - Single photo renders EXACTLY like a plain hero <img> (no dots / zones /
//    controls), so a one-photo profile looks unchanged.
//
// Navigation (accessible):
//  - Dot indicators are real <button>s labelled "Photo N of M" (aria-current on
//    the active one) — keyboard-operable, 44px touch targets.
//  - Optional left/right tap zones (thirds of the image) as <button>s.
//  - ArrowLeft / ArrowRight move within the gallery when it has focus.
//  - `swipe` adds horizontal touch-swipe (for modals). The Discover deck leaves
//    this OFF so photo nav never conflicts with the card's like/skip swipe.

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export default function PhotoCarousel({
  photos,
  name,
  height = 380,
  swipe = false,
  containerStyle,
}) {
  const list = Array.isArray(photos) ? photos.filter((p) => p && p.url) : [];
  const total = list.length;

  // All hooks run before any early return (React #310 discipline).
  const [current, setCurrent] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const touchStartX = useRef(null);

  // Clamp the index if the photo set shrinks/changes (e.g. a modal reloads a
  // different profile into the same mounted carousel).
  useEffect(() => {
    setCurrent((c) => (c >= total ? 0 : c));
  }, [total]);

  const baseImg = {
    width: "100%",
    height,
    objectFit: "cover",
    borderRadius: 16,
    display: "block",
    background: t.surfaceAlt,
  };

  const altFor = (p, i) =>
    p && p.description && p.description.trim()
      ? p.description
      : `Photo ${i + 1} of ${total}${name ? ` — ${name}` : ""}`;

  // The stored per-photo description, surfaced as an OPTIONAL visible caption
  // below the image (it already doubles as the alt text above). Calm, small,
  // muted — only rendered when the member actually wrote one.
  const captionFor = (p) =>
    p && typeof p.description === "string" ? p.description.trim() : "";
  const captionStyle = {
    margin: "8px 4px 0",
    fontSize: 14,
    color: t.textSoft,
    lineHeight: 1.5,
  };

  if (total === 0) return null;

  // Single photo — identical to the previous plain hero image (no controls),
  // now with an optional visible caption beneath it.
  if (total === 1) {
    const only = list[0];
    const cap = captionFor(only);
    return (
      <figure style={{ margin: 0, ...containerStyle }}>
        <img
          src={only.url}
          alt={altFor(only, 0)}
          decoding="async"
          style={baseImg}
        />
        {cap && (
          <figcaption data-photo-caption="true" style={captionStyle}>{cap}</figcaption>
        )}
      </figure>
    );
  }

  const idx = Math.min(current, total - 1);
  const photo = list[idx];
  const go = (n) => setCurrent(((n % total) + total) % total);
  const goPrev = () => go(idx - 1);
  const goNext = () => go(idx + 1);

  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  };

  const onTouchStart = swipe
    ? (e) => {
        touchStartX.current = e.touches?.[0]?.clientX ?? null;
      }
    : undefined;
  const onTouchEnd = swipe
    ? (e) => {
        if (touchStartX.current == null) return;
        const dx = (e.changedTouches?.[0]?.clientX ?? 0) - touchStartX.current;
        if (Math.abs(dx) > 40) {
          if (dx < 0) goNext();
          else goPrev();
        }
        touchStartX.current = null;
      }
    : undefined;

  const zoneStyle = (side) => ({
    position: "absolute",
    top: 0,
    bottom: 44, // leave the dot row unobstructed
    [side]: 0,
    width: "33%",
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  });

  const cap = captionFor(photo);

  return (
    <figure style={{ margin: 0, ...containerStyle }}>
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={`Photos of ${name || "this person"}`}
      onKeyDown={onKeyDown}
      style={{ position: "relative" }}
    >
      <img
        // Re-mount on navigation ONLY when motion is allowed, so the gentle
        // opacity fade plays. Under reduced motion the element is stable and the
        // src simply swaps — no animation.
        key={reducedMotion ? "static" : idx}
        src={photo.url}
        alt={altFor(photo, idx)}
        decoding="async"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          ...baseImg,
          ...(reducedMotion ? null : { animation: "spectrumPhotoFade 220ms ease" }),
        }}
      />

      {/* Tap zones — left/right thirds. Never a horizontal swipe on the deck. */}
      <button
        type="button"
        onClick={goPrev}
        aria-label={`Previous photo (showing ${idx + 1} of ${total})`}
        style={zoneStyle("left")}
      />
      <button
        type="button"
        onClick={goNext}
        aria-label={`Next photo (showing ${idx + 1} of ${total})`}
        style={zoneStyle("right")}
      />

      {/* Dot indicators — real buttons, labelled, 44px touch targets. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 6,
          display: "flex",
          justifyContent: "center",
          gap: 4,
          pointerEvents: "none",
        }}
      >
        {list.map((p, i) => {
          const active = i === idx;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setCurrent(i)}
              aria-label={`Photo ${i + 1} of ${total}`}
              aria-current={active ? "true" : undefined}
              style={{
                width: 44,
                height: 44,
                padding: 0,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "auto",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "block",
                  width: active ? 9 : 7,
                  height: active ? 9 : 7,
                  borderRadius: "50%",
                  background: active ? "#fff" : "rgba(255,255,255,0.55)",
                  boxShadow: "0 0 3px rgba(0,0,0,0.45)",
                  transition: reducedMotion ? "none" : "width 120ms ease, height 120ms ease",
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
      {cap && (
        <figcaption data-photo-caption="true" style={captionStyle}>{cap}</figcaption>
      )}
    </figure>
  );
}
