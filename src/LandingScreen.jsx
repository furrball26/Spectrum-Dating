import { useState } from "react";
import { t } from "./tokens.js";
import SpectrumMark from "./SpectrumMark.jsx";
import { ShieldIcon, GearIcon, HeartIcon, SealCheckIcon } from "./icons.jsx";

// LandingScreen — the calm public front door for Spectrum Dating.
// Mobile-first, generous whitespace, low-stimulation. No autoplay motion;
// the only movement is a gentle one-shot fade on mount, suppressed under
// reduced-motion (App injects a global reduce-motion stylesheet, and we also
// honour the prefers-reduced-motion media query inline). All colours come from
// the themed `t.*` tokens so light/dim themes are handled automatically.

const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

// A calm tile-pair motif borrowed from the brand mark, used as a step indicator
// and small section accent. Decorative only.
function StepTiles({ color }) {
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      <rect x="0" y="0" width="11" height="11" rx="2.5" fill={color} fillOpacity={0.9} />
      <rect x="15" y="0" width="11" height="11" rx="2.5" fill={color} fillOpacity={0.35} />
      <rect x="0" y="15" width="11" height="11" rx="2.5" fill={color} fillOpacity={0.35} />
      <rect x="15" y="15" width="11" height="11" rx="2.5" fill={color} fillOpacity={0.9} />
    </svg>
  );
}

function PrimaryButton({ children, onClick, style }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      {...f}
      style={{
        minHeight: 52,
        padding: "14px 24px",
        borderRadius: 12,
        fontSize: 16,
        fontWeight: 700,
        fontFamily: t.sans,
        background: t.accentStrong,
        color: "#fff",
        border: `1px solid ${t.accentStrong}`,
        cursor: "pointer",
        transition: "background 150ms ease",
        ...f.style,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function TertiaryButton({ children, onClick, style }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      {...f}
      style={{
        minHeight: 52,
        padding: "14px 24px",
        borderRadius: 12,
        fontSize: 16,
        fontWeight: 600,
        fontFamily: t.sans,
        background: "transparent",
        color: t.accentStrong,
        border: `1px solid ${t.border}`,
        cursor: "pointer",
        transition: "background 150ms ease, border-color 150ms ease",
        ...f.style,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

const VALUES = [
  {
    Icon: HeartIcon,
    title: "No pressure",
    body:
      "No typing indicators, no “online now”, no read-receipt anxiety. Reply whenever you have the energy — conversations wait for you.",
  },
  {
    Icon: GearIcon,
    title: "Clarity over guesswork",
    body:
      "Match on communication style and sensory needs, not just photos. Deal-breakers are stated plainly, so you always know where you stand.",
  },
  {
    Icon: ShieldIcon,
    title: "Safety first",
    body:
      "Profile verification, straightforward reporting, and a real safety center — built in from the start, not bolted on.",
  },
  {
    Icon: SealCheckIcon,
    title: "Built with the community",
    body:
      "Designed with and for autistic adults. Nothing about us without us — your feedback shapes what comes next.",
  },
];

const STEPS = [
  {
    color: t.green500,
    title: "Make your profile",
    body: "Share what matters to you at your own pace. Skip anything that doesn't fit.",
  },
  {
    color: t.teal,
    title: "Discover people who fit",
    body: "See calm, honest profiles matched on how you connect — not endless swiping.",
  },
  {
    color: t.clay,
    title: "Talk when you're ready",
    body: "Message only the people you've both matched with. There's never a rush.",
  },
];

export default function LandingScreen({ onGetStarted, onSignIn }) {
  const section = {
    width: "100%",
    maxWidth: 760,
    margin: "0 auto",
    boxSizing: "border-box",
    padding: "0 20px",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: t.bgGradient,
        color: t.text,
        fontFamily: t.sans,
        fontSize: 16,
        lineHeight: 1.6,
        // Gentle one-shot fade-in; neutralised by the global reduce-motion
        // stylesheet and by the inline media query below.
        animation: "spectrumLandingFade 600ms ease both",
      }}
    >
      {/* Scoped reduced-motion guard (belt-and-braces with App's global sheet). */}
      <style>{`
        @keyframes spectrumLandingFade {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-landing] { animation: none !important; }
        }
      `}</style>
      <div data-landing>
        {/* ── Hero ──────────────────────────────────────────────── */}
        <header
          style={{
            ...section,
            paddingTop: 56,
            paddingBottom: 24,
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 40,
            }}
          >
            <SpectrumMark height={32} />
            <span
              style={{
                fontFamily: t.serif,
                fontWeight: 700,
                fontSize: 30,
                letterSpacing: "-0.01em",
                color: t.text,
              }}
            >
              Spectrum
            </span>
          </div>

          <h1
            style={{
              fontFamily: t.serif,
              fontWeight: 700,
              fontSize: 40,
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              margin: "0 auto 18px",
              maxWidth: 520,
              color: t.text,
            }}
          >
            Dating at your own pace.
          </h1>
          <p
            style={{
              fontSize: 18,
              color: t.textSoft,
              maxWidth: 460,
              margin: "0 auto 36px",
            }}
          >
            A calmer, clearer way to meet people — made with and for autistic
            adults.
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              justifyContent: "center",
            }}
          >
            <PrimaryButton onClick={onGetStarted}>Create your profile</PrimaryButton>
            <TertiaryButton onClick={onSignIn}>Sign in</TertiaryButton>
          </div>
        </header>

        {/* ── Why Spectrum is different ─────────────────────────── */}
        <section style={{ ...section, paddingTop: 48, paddingBottom: 24 }} aria-labelledby="why-heading">
          <h2
            id="why-heading"
            style={{
              fontFamily: t.serif,
              fontWeight: 700,
              fontSize: 28,
              letterSpacing: "-0.01em",
              margin: "0 0 24px",
              textAlign: "center",
              color: t.text,
            }}
          >
            Why Spectrum is different
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
            }}
          >
            {VALUES.map(({ Icon, title, body }) => (
              <div
                key={title}
                style={{
                  background: t.surface,
                  border: `1px solid ${t.border}`,
                  borderRadius: 16,
                  padding: "22px 20px",
                  boxShadow: "0 1px 4px rgba(36,51,45,0.05)",
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: t.green50,
                    color: t.accentStrong,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 14,
                  }}
                >
                  <Icon size={22} />
                </div>
                <h3
                  style={{
                    fontFamily: t.serif,
                    fontWeight: 700,
                    fontSize: 19,
                    margin: "0 0 6px",
                    color: t.text,
                  }}
                >
                  {title}
                </h3>
                <p style={{ margin: 0, fontSize: 15, color: t.textSoft, lineHeight: 1.55 }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────── */}
        <section style={{ ...section, paddingTop: 48, paddingBottom: 24 }} aria-labelledby="how-heading">
          <h2
            id="how-heading"
            style={{
              fontFamily: t.serif,
              fontWeight: 700,
              fontSize: 28,
              letterSpacing: "-0.01em",
              margin: "0 0 24px",
              textAlign: "center",
              color: t.text,
            }}
          >
            How it works
          </h2>

          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: 14,
            }}
          >
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 16,
                  background: t.surface,
                  border: `1px solid ${t.border}`,
                  borderRadius: 16,
                  padding: "18px 20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  <StepTiles color={step.color} />
                  <span
                    aria-hidden="true"
                    style={{
                      fontFamily: t.serif,
                      fontWeight: 700,
                      fontSize: 14,
                      color: t.textMuted,
                    }}
                  >
                    {i + 1}
                  </span>
                </div>
                <div>
                  <h3
                    style={{
                      fontFamily: t.serif,
                      fontWeight: 700,
                      fontSize: 19,
                      margin: "0 0 4px",
                      color: t.text,
                    }}
                  >
                    {step.title}
                  </h3>
                  <p style={{ margin: 0, fontSize: 15, color: t.textSoft }}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Closing CTA ───────────────────────────────────────── */}
        <section style={{ ...section, paddingTop: 48, paddingBottom: 48 }}>
          <div
            style={{
              background: t.green50,
              border: `1px solid ${t.green100}`,
              borderRadius: 20,
              padding: "36px 28px",
              textAlign: "center",
            }}
          >
            <h2
              style={{
                fontFamily: t.serif,
                fontWeight: 700,
                fontSize: 26,
                letterSpacing: "-0.01em",
                margin: "0 0 10px",
                color: t.text,
              }}
            >
              Ready when you are.
            </h2>
            <p style={{ margin: "0 0 24px", fontSize: 16, color: t.textSoft }}>
              Free to join. Leave whenever you like.
            </p>
            <PrimaryButton onClick={onGetStarted}>Create your profile</PrimaryButton>
          </div>
        </section>

        {/* ── Footer ────────────────────────────────────────────── */}
        <footer
          style={{
            ...section,
            paddingTop: 8,
            paddingBottom: 48,
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <SpectrumMark height={12} />
            <span
              style={{
                fontFamily: t.serif,
                fontWeight: 700,
                fontSize: 15,
                color: t.textMuted,
              }}
            >
              Spectrum
            </span>
          </div>
          <p style={{ margin: "0 0 6px", fontSize: 14, color: t.textMuted, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>
            A calmer place to meet people, built with the autistic community.
          </p>
          <p style={{ margin: 0, fontSize: 14, color: t.textMuted }}>
            Your safety &amp; privacy matter.
          </p>
        </footer>
      </div>
    </div>
  );
}
