import { useState } from "react";
import { t } from "./tokens.js";
import SpectrumMark from "./SpectrumMark.jsx";
import AnimatedSpectrumMark from "./AnimatedSpectrumMark.jsx";
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
        transition: `background ${t.motion.base} ${t.motion.standard}`,
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
        transition: `background ${t.motion.base} ${t.motion.standard}, border-color ${t.motion.base} ${t.motion.standard}`,
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
        {/* Main landmark + skip-link target — the front door needs both. */}
        <main id="main-content" tabIndex={-1}>
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
            <AnimatedSpectrumMark height={36} idle />
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
            Meet people at your own pace.
          </h1>
          <p
            style={{
              fontSize: 18,
              color: t.textSoft,
              maxWidth: 480,
              margin: "0 auto 36px",
            }}
          >
            No typing dots. No “online now.” No rush. A calmer way to date,
            made with and for autistic adults.
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
          <p style={{ margin: "16px 0 0", fontSize: 14, color: t.textMuted }}>
            Free to join. Leave whenever you like.
          </p>

          {/* Product glimpse — a calm discovery card (no faces) so visitors see
              what they're joining. Decorative; the copy above conveys the brand. */}
          <div aria-hidden="true" style={{ marginTop: 48, display: "flex", justifyContent: "center" }}>
            <svg width="300" height="290" viewBox="0 0 300 290" xmlns="http://www.w3.org/2000/svg" role="img">
              <defs>
                <linearGradient id="heroAv" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={t.green400} />
                  <stop offset="100%" stopColor={t.teal} />
                </linearGradient>
              </defs>
              {/* card peeking behind — suggests a calm, one-at-a-time deck */}
              <rect x="48" y="40" width="216" height="222" rx="20" fill={t.surface} stroke={t.border} opacity="0.55" />
              {/* front card */}
              <rect x="28" y="30" width="240" height="232" rx="22" fill={t.surface} stroke={t.border} />
              {/* avatar (gradient, no face) + name/tagline */}
              <circle cx="74" cy="80" r="26" fill="url(#heroAv)" />
              <rect x="112" y="66" width="116" height="13" rx="6.5" fill={t.green300} />
              <rect x="112" y="88" width="84" height="9" rx="4.5" fill={t.borderLight} />
              {/* verified pill */}
              <rect x="204" y="64" width="44" height="16" rx="8" fill="none" stroke={t.positive} />
              <path d="M212 72l3 3 6-6" fill="none" stroke={t.positive} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              {/* interest chips */}
              <rect x="48" y="124" width="58" height="22" rx="11" fill={t.green50} stroke={t.green100} />
              <rect x="114" y="124" width="48" height="22" rx="11" fill={t.green50} stroke={t.green100} />
              <rect x="170" y="124" width="70" height="22" rx="11" fill={t.green50} stroke={t.green100} />
              {/* two calm "why you're seeing them" rows */}
              <circle cx="54" cy="170" r="3" fill={t.accent} />
              <rect x="64" y="166" width="150" height="8" rx="4" fill={t.borderLight} />
              <circle cx="54" cy="188" r="3" fill={t.accent} />
              <rect x="64" y="184" width="120" height="8" rx="4" fill={t.borderLight} />
              {/* calm primary action */}
              <rect x="48" y="214" width="200" height="30" rx="12" fill={t.accentFill} />
              <rect x="118" y="225" width="60" height="8" rx="4" fill={t.surface} opacity="0.9" />
            </svg>
          </div>
        </header>

        {/* ── What you won't find here (the "removed things" manifesto) ─── */}
        <section style={{ ...section, paddingTop: 40, paddingBottom: 8 }} aria-labelledby="manifesto-heading">
          <div
            style={{
              background: t.surface,
              border: `1px solid ${t.border}`,
              borderRadius: 20,
              padding: "28px 24px",
              textAlign: "center",
            }}
          >
            <h2
              id="manifesto-heading"
              style={{
                fontFamily: t.serif,
                fontWeight: 700,
                fontSize: 24,
                letterSpacing: "-0.01em",
                margin: "0 0 6px",
                color: t.text,
              }}
            >
              What you won’t find here
            </h2>
            <p style={{ margin: "0 0 20px", fontSize: 15, color: t.textSoft }}>
              We left out the things that make dating apps exhausting.
            </p>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                justifyContent: "center",
              }}
            >
              {[
                "No typing indicators",
                "No “online now”",
                "We never show when you’ve read a message",
                "No streaks",
                "No red-dot anxiety",
                "No swiping games",
              ].map((item) => (
                <li
                  key={item}
                  style={{
                    background: t.green50,
                    color: t.accentStrong,
                    border: `1px solid ${t.green100}`,
                    borderRadius: 999,
                    padding: "8px 14px",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

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

        {/* ── Match-moment tease ────────────────────────────────── */}
        <section style={{ ...section, paddingTop: 40, paddingBottom: 8 }}>
          <p
            style={{
              textAlign: "center",
              fontFamily: t.serif,
              fontSize: 20,
              lineHeight: 1.5,
              color: t.textSoft,
              maxWidth: 520,
              margin: "0 auto",
            }}
          >
            When you match, we celebrate quietly — no confetti, no noise. Just a
            calm moment that says you’re on the same wavelength.
          </p>
        </section>

        {/* ── Closing CTA ───────────────────────────────────────── */}
        <section style={{ ...section, paddingTop: 40, paddingBottom: 48 }}>
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
        </main>

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
          <p style={{ margin: "0 0 6px", fontSize: 14, color: t.textMuted, maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
            Built with autistic adults. Always opt-in. No dark patterns, ever.
          </p>
          <p style={{ margin: 0, fontSize: 14, color: t.textMuted }}>
            Your safety &amp; privacy come first.
          </p>
        </footer>
      </div>
    </div>
  );
}
