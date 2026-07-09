import { useEffect, useRef } from "react";
import { t } from "./tokens.js";
import { useFocusable } from "./useFocusable.js";
import { usePlainLanguage } from "./PlainLanguageContext.jsx";
import {
  TERMS_UPDATED,
  TERMS_UPDATED_NOTE,
  TERMS_SHORT,
  TERMS_SECTIONS,
} from "./terms.js";

// ── Terms & Community Standards ───────────────────────────────────────────────
// The in-app, calm, low-sensory rendering of the published Terms of Service
// (src/terms.js — transcribed from /TERMS_OF_SERVICE.md). Reachable from Settings
// (authed) and from the sign-up form (logged-out overlay). Content-only screen —
// no fetches, no state — so all it owns is a heading-focus effect and its own
// focusable Back button. Same shell language as SettingsScreen/SafetyScreen.

// Back button — its own component so useFocusable is one-hook-per-instance,
// above any early return (React #310 discipline).
function BackButton({ onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      {...f}
      style={{
        minHeight: 44,
        padding: "10px 18px",
        borderRadius: 11,
        border: `1px solid ${t.formBorder}`,
        cursor: "pointer",
        fontSize: 16,
        fontWeight: 600,
        background: t.green100,
        color: t.text,
        ...f.style,
      }}
    >
      ← Back
    </button>
  );
}

const sectionHeading = {
  fontFamily: t.serif,
  fontSize: 21,
  fontWeight: 600,
  margin: "36px 0 10px",
  color: t.text,
  lineHeight: 1.3,
};

const bodyText = {
  margin: "0 0 12px",
  fontSize: 16,
  color: t.textSoft,
  lineHeight: 1.7,
};

export default function TermsScreen({ onBack }) {
  const plain = usePlainLanguage();
  const headingRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div
      style={{
        minHeight: "100%",
        background: t.bgGradient,
        color: t.text,
        fontFamily: t.sans,
        fontSize: 16,
        lineHeight: 1.7,
        padding: "20px 16px 60px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: t.layout.maxContent, margin: "0 auto" }}>
        <BackButton onClick={onBack} />

        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{
            fontFamily: t.serif,
            fontSize: 28,
            fontWeight: 700,
            margin: "18px 0 6px",
            color: t.text,
            outline: "none",
          }}
        >
          {plain ? "Our Rules & Terms" : "Terms & Community Standards"}
        </h1>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: t.textMuted }}>
          {plain ? "Changed on " : "Last updated: "}{TERMS_UPDATED} · {TERMS_UPDATED_NOTE}
        </p>

        {/* The short version — a calm summary card, clearly marked as a summary,
            not the binding rules. */}
        <section
          aria-label={TERMS_SHORT.heading}
          style={{
            background: t.green50,
            border: `1px solid ${t.green200}`,
            borderRadius: t.radius.lg,
            padding: "18px 20px",
            marginBottom: 12,
          }}
        >
          <h2
            style={{
              fontFamily: t.serif,
              fontSize: 20,
              fontWeight: 700,
              margin: "0 0 2px",
              color: t.text,
            }}
          >
            {TERMS_SHORT.heading}
          </h2>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: t.textMuted, fontStyle: "italic" }}>
            {TERMS_SHORT.note}
          </p>
          <p style={{ margin: "0 0 14px", fontSize: 16, color: t.text, lineHeight: 1.65 }}>
            {TERMS_SHORT.intro}
          </p>
          {TERMS_SHORT.groups.map((g) => (
            <div key={g.heading} style={{ marginBottom: 12 }}>
              <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700, color: t.text }}>
                {g.heading}
              </p>
              <ul style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6 }}>
                {g.items.map((it, i) => (
                  <li key={i} style={{ fontSize: 16, color: t.textSoft, lineHeight: 1.6 }}>
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p style={{ margin: "4px 0 0", fontSize: 15, color: t.textSoft, lineHeight: 1.65 }}>
            {TERMS_SHORT.outro}
          </p>
        </section>

        {/* The binding, numbered sections. */}
        {TERMS_SECTIONS.map((s) => (
          <section key={s.n} aria-labelledby={`terms-section-${s.n}`}>
            <h2 id={`terms-section-${s.n}`} style={sectionHeading}>
              {s.n}. {s.title}
            </h2>

            {s.intro && <p style={bodyText}>{s.intro}</p>}

            {Array.isArray(s.paragraphs) &&
              s.paragraphs.map((p, i) => (
                <p key={i} style={bodyText}>
                  {p}
                </p>
              ))}

            {Array.isArray(s.bullets) && (
              <ul style={{ margin: "0 0 12px", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
                {s.bullets.map((b, i) => (
                  <li key={i} style={{ fontSize: 16, color: t.textSoft, lineHeight: 1.7 }}>
                    {b}
                  </li>
                ))}
              </ul>
            )}

            {Array.isArray(s.clauses) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 6 }}>
                {s.clauses.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      background: t.surface,
                      border: `1px solid ${t.cardBorder}`,
                      borderRadius: t.radius.lg,
                      padding: "14px 18px",
                      boxShadow: t.shadow.sm,
                    }}
                  >
                    <p style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: t.text, lineHeight: 1.5 }}>
                      <span style={{ color: t.accentStrong }}>{c.id}</span> — {c.title}
                    </p>
                    <p style={{ margin: "0 0 8px", fontSize: 16, color: t.textSoft, lineHeight: 1.65 }}>
                      {c.body}
                    </p>
                    <p style={{ margin: 0, fontSize: 14, color: t.textMuted, fontStyle: "italic", lineHeight: 1.5 }}>
                      {c.consequence}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
