import { useState, useRef, useEffect } from "react";
import { t } from "./tokens.js";
import Avatar from "./Avatar.jsx";
import Button from "./Button.jsx";

// MatchMoment — the signature "you're on the same wavelength" overlay shown
// when a NEW mutual match happens. Calm, opacity-led, low-stimulation. No
// confetti, no bounce, no scale-springs, no sound.
//
// Choreography (all short travel + soft deceleration):
//  1. Warm dim backdrop fades in.
//  2. Two Avatars (you left, them right) start ~24px apart and glide to a small
//     gap over t.motion.slow with t.motion.gentle easing (translate only, ≤24px).
//  3. As they meet, 6 spectrum tiles draw in left→right between them (each tile
//     staggered ~60ms, fade + grow from 2px) like a connecting thread.
//  4. A serif line + subline settle in under them.
//  5. Two calm buttons: "Say hello" (primary) and "Keep looking" (tertiary).
//
// Reduced motion: render the END state immediately (avatars together, tiles
// drawn, text visible) with only a gentle opacity fade — no movement.

// Brand 6-colour ramp, same literal hex as Spectrum.jsx (intentionally un-themed).
const RAMP = [
  "#5E9459", // green
  "#4F8A8B", // teal
  "#3E6660", // deep teal
  "#6FA39A", // soft teal-green
  "#C9A875", // clay
  "#E7D9C4", // sand
];

const TILE_STAGGER = 60; // ms between each tile drawing in
const TILE_BASE_DELAY = 220; // ms before the first tile starts (avatars mostly met)

// Dynamic prefers-reduced-motion (mirrors UnmatchSheet.jsx hook).
function usePrefersReduced() {
  const [prefersReduced, setPrefersReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e) => setPrefersReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return prefersReduced;
}

export default function MatchMoment({ you, them, onContinue, onOpenChat }) {
  const prefersReduced = usePrefersReduced();
  // `entered` flips on after mount to trigger the opacity-led transitions.
  // Under reduced-motion we start already-entered so the end state renders
  // immediately (no movement, just the global fade).
  const [entered, setEntered] = useState(prefersReduced);

  const headingRef = useRef(null);
  const helloRef = useRef(null);
  const keepRef = useRef(null);

  // Kick off the choreography on the next frame so the initial (pre-enter)
  // styles paint first, then transition to the entered state.
  useEffect(() => {
    if (prefersReduced) return;
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [prefersReduced]);

  // Focus the heading on open (announced via aria-labelledby on the dialog).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Escape → onContinue. Focus trap between the two buttons.
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onContinue?.();
        return;
      }
      if (e.key === "Tab") {
        const focusable = [helloRef.current, keepRef.current].filter(Boolean);
        if (focusable.length === 0) return;
        const idx = focusable.indexOf(document.activeElement);
        if (e.shiftKey) {
          if (idx <= 0) {
            e.preventDefault();
            focusable[focusable.length - 1]?.focus();
          }
        } else {
          if (idx === focusable.length - 1 || idx === -1) {
            e.preventDefault();
            focusable[0]?.focus();
          }
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onContinue]);

  const gentle = t.motion.gentle;
  const slow = t.motion.slow;

  // Avatars: start ~24px apart (translated outward), glide to a small gap.
  const youAvatarStyle = {
    transform: entered ? "translateX(0)" : "translateX(-24px)",
    opacity: entered ? 1 : 0,
    transition: `transform ${slow} ${gentle}, opacity ${slow} ${gentle}`,
  };
  const themAvatarStyle = {
    transform: entered ? "translateX(0)" : "translateX(24px)",
    opacity: entered ? 1 : 0,
    transition: `transform ${slow} ${gentle}, opacity ${slow} ${gentle}`,
  };

  const textStyle = {
    opacity: entered ? 1 : 0,
    transform: entered ? "translateY(0)" : "translateY(8px)",
    transition: `opacity ${slow} ${gentle} 360ms, transform ${slow} ${gentle} 360ms`,
  };

  const buttonsStyle = {
    opacity: entered ? 1 : 0,
    transition: `opacity ${slow} ${gentle} 440ms`,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-moment-heading"
      aria-describedby="match-moment-subline"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        boxSizing: "border-box",
        background: "rgba(36,51,45,0.55)",
        opacity: entered ? 1 : 0,
        transition: `opacity ${slow} ${gentle}`,
        fontFamily: t.sans,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        {/* Avatars + connecting spectrum thread */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            marginBottom: 28,
          }}
        >
          <Avatar
            name={you?.name}
            userId={you?.userId}
            photoUrl={you?.photoUrl}
            size={88}
            style={youAvatarStyle}
          />

          {/* The 6 spectrum tiles draw in left→right between the avatars. */}
          <div
            aria-hidden="true"
            style={{ display: "flex", alignItems: "center", gap: 5 }}
          >
            {RAMP.map((c, i) => {
              const tileStyle = {
                width: 8,
                height: 8,
                borderRadius: 2,
                background: c,
                // grow from 2px → 8px via scale, fade in. Reduced-motion =
                // already drawn (entered starts true), global sheet zeroes any
                // residual transition.
                transform: entered ? "scale(1)" : "scale(0.25)",
                opacity: entered ? 1 : 0,
                transition: `transform ${t.motion.base} ${gentle} ${
                  TILE_BASE_DELAY + i * TILE_STAGGER
                }ms, opacity ${t.motion.base} ${gentle} ${
                  TILE_BASE_DELAY + i * TILE_STAGGER
                }ms`,
              };
              return <span key={i} style={tileStyle} />;
            })}
          </div>

          <Avatar
            name={them?.name}
            userId={them?.userId}
            photoUrl={them?.photoUrl}
            size={88}
            style={themAvatarStyle}
          />
        </div>

        {/* Calm serif line + subline */}
        <div style={textStyle}>
          <h1
            id="match-moment-heading"
            ref={headingRef}
            tabIndex={-1}
            style={{
              fontFamily: t.serif,
              fontSize: 26,
              fontWeight: 700,
              lineHeight: 1.3,
              color: "#FFFFFF",
              margin: "0 0 10px",
              outline: "none",
              letterSpacing: "-0.01em",
            }}
          >
            You're on the same wavelength.
          </h1>
          <p
            id="match-moment-subline"
            style={{
              fontFamily: t.sans,
              fontSize: 16,
              lineHeight: 1.6,
              color: "rgba(244,245,242,0.82)",
              margin: 0,
            }}
          >
            You both said yes.
          </p>
        </div>

        {/* Two calm actions */}
        <div
          style={{
            ...buttonsStyle,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            width: "100%",
            maxWidth: 320,
            marginTop: 32,
          }}
        >
          <Button
            ref={helloRef}
            variant="primary"
            onClick={onOpenChat}
            style={{ width: "100%" }}
          >
            Say hello
          </Button>
          <Button
            ref={keepRef}
            variant="tertiary"
            onClick={onContinue}
            style={{ width: "100%", color: "#FFFFFF" }}
          >
            Keep looking
          </Button>
        </div>
      </div>
    </div>
  );
}
