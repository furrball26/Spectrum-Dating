import { t } from "./tokens.js";
import SpectrumMark from "./SpectrumMark.jsx";
import AnimatedSpectrumMark from "./AnimatedSpectrumMark.jsx";
import { ShieldIcon, GearIcon, HeartIcon, SealCheckIcon } from "./icons.jsx";
import { useFocusable } from "./useFocusable.js";

// LandingScreen — the calm public front door for Spectrum Dating.
// Mobile-first, generous whitespace, low-stimulation. No autoplay motion;
// the only movement is a gentle one-shot fade on mount, suppressed under
// reduced-motion (App injects a global reduce-motion stylesheet, and we also
// honour the prefers-reduced-motion media query inline). All colours come from
// the themed `t.*` tokens so light/dim themes are handled automatically.


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
      "Profile review, straightforward reporting, and a real safety center — built in from the start, not bolted on.",
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
        {/* Soft static brand wash behind the hero — a whisper of the spectrum
            ramp (green → teal → sand) so the first screen has atmosphere
            instead of blank paper. Static (no motion), extremely low contrast,
            and behind everything (zIndex 0 wrapper, content above). */}
        <div style={{ position: "relative" }}>
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              overflow: "hidden",
              pointerEvents: "none",
              background: [
                "radial-gradient(56% 44% at 18% 6%, rgba(94,148,89,0.10) 0%, rgba(94,148,89,0) 70%)",
                "radial-gradient(50% 42% at 84% 12%, rgba(79,138,139,0.10) 0%, rgba(79,138,139,0) 70%)",
                "radial-gradient(64% 50% at 55% 88%, rgba(201,168,117,0.12) 0%, rgba(201,168,117,0) 72%)",
              ].join(", "),
            }}
          />
        <header
          style={{
            ...section,
            position: "relative",
            paddingTop: "calc(56px + env(safe-area-inset-top, 0px))",
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
            {/* height 24 keeps the full lockup inside a 390px viewport
                (36 made the row overflow and clip the wordmark on phones). */}
            <AnimatedSpectrumMark height={24} idle />
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
              // Real display scale — Newsreader's optical axis (opsz) kicks in
              // at large sizes and carries the brand voice.
              fontSize: "clamp(42px, 8vw, 56px)",
              lineHeight: 1.12,
              letterSpacing: "-0.02em",
              margin: "0 auto 18px",
              maxWidth: 560,
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

          {/* Product glimpse — a finished, branded discovery card (no faces) so
              visitors see what they're joining. Real fills + the spectrum strip
              + a soft cast shadow: a product shot, not a wireframe. Decorative. */}
          <div aria-hidden="true" style={{ marginTop: 48, display: "flex", justifyContent: "center" }}>
            <svg width="300" height="300" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" role="img">
              <defs>
                <linearGradient id="heroAv" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={t.green400} />
                  <stop offset="100%" stopColor={t.teal} />
                </linearGradient>
                <linearGradient id="heroWarm" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="var(--mark-6, #E7D9C4)" />
                  <stop offset="100%" stopColor="var(--mark-5, #C9A875)" />
                </linearGradient>
                <filter id="heroShadow" x="-20%" y="-20%" width="140%" height="150%">
                  <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="#24332D" floodOpacity="0.16" />
                </filter>
              </defs>
              {/* card peeking behind — suggests a calm, one-at-a-time deck */}
              <rect x="50" y="44" width="216" height="226" rx="20" fill={t.surface} stroke={t.cardBorder} opacity="0.6" />
              {/* front card, with a real cast shadow */}
              <g filter="url(#heroShadow)">
                <rect x="28" y="32" width="240" height="240" rx="22" fill={t.surface} stroke={t.cardBorder} />
              </g>
              {/* spectrum strip — the brand fingerprint on the card */}
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <rect key={i} x={44 + i * 35.4} y="46" width="31" height="5" rx="2.5" fill={`var(--mark-${i + 1})`} />
              ))}
              {/* warm portrait block (abstract, no face) + gradient avatar */}
              <rect x="44" y="62" width="208" height="64" rx="14" fill="url(#heroWarm)" opacity="0.5" />
              <circle cx="84" cy="94" r="24" fill="url(#heroAv)" />
              {/* name + tagline */}
              <rect x="120" y="80" width="104" height="12" rx="6" fill={t.green700} />
              <rect x="120" y="100" width="76" height="8" rx="4" fill={t.green300} />
              {/* reviewed pill */}
              <rect x="204" y="64" width="40" height="15" rx="7.5" fill={t.surface} stroke={t.positiveText} />
              <path d="M211 71.5l3 3 6-6" fill="none" stroke={t.positiveText} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              {/* interest chips — one warm chip for the two-color brand */}
              <rect x="44" y="142" width="58" height="22" rx="11" fill={t.green100} stroke={t.green300} />
              <rect x="110" y="142" width="48" height="22" rx="11" fill={t.green100} stroke={t.green300} />
              <rect x="166" y="142" width="70" height="22" rx="11" fill="var(--mark-6, #E7D9C4)" stroke="var(--mark-5, #C9A875)" />
              {/* two calm "why you're seeing them" rows */}
              <circle cx="50" cy="186" r="3.5" fill={t.accent} />
              <rect x="62" y="182" width="150" height="8" rx="4" fill={t.green200} />
              <circle cx="50" cy="204" r="3.5" fill={t.accent} />
              <rect x="62" y="200" width="120" height="8" rx="4" fill={t.green200} />
              {/* calm primary action */}
              <rect x="44" y="224" width="208" height="32" rx="12" fill={t.accentFill} />
              <rect x="118" y="236" width="60" height="8" rx="4" fill="#FFFFFF" opacity="0.92" />
            </svg>
          </div>
        </header>
        </div>

        {/* ── What you won't find here (the "removed things" manifesto) ─── */}
        <section style={{ ...section, paddingTop: 40, paddingBottom: 8 }} aria-labelledby="manifesto-heading">
          <div
            style={{
              background: t.surface,
              border: `1px solid ${t.cardBorder}`,
              borderRadius: 20,
              padding: "32px 24px",
              textAlign: "center",
              boxShadow: t.shadow.sm,
            }}
          >
            <p style={{ ...t.eyebrow, marginBottom: 10 }}>Our promise</p>
            <h2
              id="manifesto-heading"
              style={{
                fontFamily: t.serif,
                fontWeight: 700,
                fontSize: 28,
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
          <p style={{ ...t.eyebrow, textAlign: "center", marginBottom: 10 }}>The approach</p>
          <h2
            id="why-heading"
            style={{
              fontFamily: t.serif,
              fontWeight: 700,
              fontSize: 32,
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
                  border: `1px solid ${t.cardBorder}`,
                  borderRadius: 16,
                  padding: "22px 20px",
                  boxShadow: t.shadow.sm,
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

        {/* ── How it works — set in a full-width tinted band so the page
            breathes in blocks instead of one flat column. ── */}
        <div style={{ background: t.green50, borderTop: `1px solid ${t.borderLight}`, borderBottom: `1px solid ${t.borderLight}`, marginTop: 40 }}>
        <section style={{ ...section, paddingTop: 44, paddingBottom: 44 }} aria-labelledby="how-heading">
          <p style={{ ...t.eyebrow, textAlign: "center", marginBottom: 10 }}>Three steps</p>
          <h2
            id="how-heading"
            style={{
              fontFamily: t.serif,
              fontWeight: 700,
              fontSize: 32,
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
                  border: `1px solid ${t.cardBorder}`,
                  borderRadius: 16,
                  padding: "18px 20px",
                  boxShadow: t.shadow.sm,
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

        </div>

        {/* ── Match-moment tease — an editorial breath with the brand mark. ── */}
        <section style={{ ...section, paddingTop: 56, paddingBottom: 16, textAlign: "center" }}>
          <SpectrumMark height={10} radius={2} style={{ marginBottom: 20 }} />
          <p
            style={{
              textAlign: "center",
              fontFamily: t.serif,
              fontSize: 24,
              lineHeight: 1.5,
              color: t.textSoft,
              maxWidth: 540,
              margin: "0 auto",
            }}
          >
            When you match, we celebrate quietly — no confetti, no noise. Just a
            calm moment that says you’re on the same wavelength.
          </p>
        </section>

        {/* ── Who we are ─────────────────────────────────────────
            ⚠️ PLACEHOLDER CONTENT — sample copy for the preview build. The
            client will supply the real team story, names, and any community-
            partner credits before launch. Keep the structure; swap the words. */}
        <section style={{ ...section, paddingTop: 40, paddingBottom: 8 }} aria-labelledby="who-heading">
          <div
            style={{
              background: t.surface,
              border: `1px solid ${t.cardBorder}`,
              borderRadius: 20,
              padding: "32px 28px",
              textAlign: "center",
              boxShadow: t.shadow.sm,
            }}
          >
            <p style={{ ...t.eyebrow, marginBottom: 10 }}>Who we are</p>
            <h2
              id="who-heading"
              style={{
                fontFamily: t.serif,
                fontWeight: 700,
                fontSize: 28,
                letterSpacing: "-0.01em",
                margin: "0 0 12px",
                color: t.text,
              }}
            >
              A small team, building with the community
            </h2>
            <p style={{ margin: "0 auto 12px", fontSize: 16, color: t.textSoft, maxWidth: 560, lineHeight: 1.65 }}>
              Spectrum is made by a small team working directly with autistic
              adults — as designers, testers, and decision-makers, not as an
              afterthought. Every feature is reviewed against one question:
              does this make meeting someone calmer, clearer, and safer?
            </p>
            <p style={{ margin: "0 auto", fontSize: 14, color: t.textMuted, maxWidth: 480, lineHeight: 1.6 }}>
              [Team introductions and community-partner credits will appear here
              closer to launch.]
            </p>
          </div>
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
            <SpectrumMark height={16} />
            <span
              style={{
                fontFamily: t.serif,
                fontWeight: 700,
                fontSize: 17,
                color: t.textSoft,
              }}
            >
              Spectrum
            </span>
          </div>
          <p style={{ margin: "0 0 6px", fontSize: 14, color: t.textMuted, maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
            Built with autistic adults. Always opt-in. No dark patterns, ever.
          </p>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: t.textMuted }}>
            Your safety &amp; privacy come first.
          </p>
          {/* Real institutional links — a credible product names its policies. */}
          <nav aria-label="Legal">
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                gap: 20,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              {[
                { label: "Privacy Policy", href: "/privacy.html" },
                { label: "Terms of Service", href: "/terms.html" },
              ].map(({ label, href }) => (
                <li key={href}>
                  <a
                    href={href}
                    style={{
                      color: t.accentStrong,
                      fontSize: 14,
                      fontWeight: 600,
                      textDecoration: "underline",
                      textUnderlineOffset: 3,
                    }}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </footer>
      </div>
    </div>
  );
}
