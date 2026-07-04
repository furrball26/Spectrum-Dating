import { useState, useEffect, useCallback, useRef } from "react";
import { t } from "./tokens.js";
import { getBillingTiers, getMyEntitlement, startCheckout, cancelSubscription, safeErrorMessage } from "./api.js";
import { useFocusable } from "./useFocusable.js";

// Membership — the member-facing billing/entitlements screen (reached from
// Settings). Design law: audit/BILLING_ARCHITECTURE.md + MONETIZATION_STRATEGY §4.
// HONEST BY DESIGN — the payment provider is the stub, so "Upgrade" NEVER shows a
// fake checkout or a fake price change: it shows a calm "coming soon" note. One
// published price, no countdowns, no "limited time", no fabricated discounts.
// Calm-by-design: no urgency, no gamification, no shaming of the free state.

// A marker string used verbatim so the change is greppable in the live bundle.
const COMING_SOON_NOTE =
  "Payment options are coming soon — you'll be able to choose how to subscribe here.";

const cardStyle = {
  background: t.surface,
  border: `1px solid ${t.cardBorder}`,
  borderRadius: 16,
  padding: "20px 20px",
  boxShadow: t.shadow.sm,
  boxSizing: "border-box",
};

// ── Small focusable controls (each its own component — hooks-before-return law) ──

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
      {"← Back"}
    </button>
  );
}

function PrimaryButton({ children, onClick, disabled }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...f}
      style={{
        minHeight: 44,
        padding: "11px 20px",
        borderRadius: 11,
        border: `1px solid ${t.accentFill}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        fontSize: 16,
        fontWeight: 600,
        background: t.accentFill,
        color: "#fff",
        ...f.style,
      }}
    >
      {children}
    </button>
  );
}

function QuietButton({ children, onClick, disabled }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...f}
      style={{
        minHeight: 44,
        padding: "10px 18px",
        borderRadius: 11,
        border: `1px solid ${t.border}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        fontSize: 15,
        fontWeight: 600,
        background: t.surface,
        color: t.textSoft,
        ...f.style,
      }}
    >
      {children}
    </button>
  );
}

// A calm "Companion" marker pill. Not tappable (no focusable needed) — it's a
// quiet status marker, never a badge/gamification element.
function CompanionBadge({ small }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: small ? "2px 9px" : "3px 11px",
        borderRadius: t.radius.pill,
        background: t.green100,
        border: `1px solid ${t.green300}`,
        color: t.accentStrong,
        fontSize: small ? 12 : 13,
        fontWeight: 700,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true">✦</span>
      Companion
    </span>
  );
}

// One tier card (informational): name, price, tagline, feature list.
function TierCard({ tier, current }) {
  const isCompanion = tier.id === "companion";
  return (
    <div
      style={{
        ...cardStyle,
        border: current ? `2px solid ${t.accentStrong}` : `1px solid ${t.cardBorder}`,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontFamily: t.serif, fontSize: 20, fontWeight: 700, color: t.text, minWidth: 0 }}>
          {tier.name}
        </h3>
        {current && (
          <span style={{ fontSize: 13, fontWeight: 700, color: t.accentStrong, whiteSpace: "nowrap" }}>
            Your plan
          </span>
        )}
      </div>
      <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 700, color: t.text }}>
        {tier.price}
      </p>
      {tier.priceNote && (
        <p style={{ margin: "2px 0 0", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
          {tier.priceNote}
        </p>
      )}
      {tier.tagline && (
        <p style={{ margin: "8px 0 0", fontSize: 14, color: t.textSoft, lineHeight: 1.55 }}>
          {tier.tagline}
        </p>
      )}
      <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {(tier.features || []).map((feat, i) => (
          <li key={i} style={{ display: "flex", gap: 8, fontSize: 14, color: t.text, lineHeight: 1.5, minWidth: 0 }}>
            <span aria-hidden="true" style={{ color: isCompanion ? t.accentStrong : t.positiveText, flexShrink: 0, fontWeight: 700 }}>
              ✓
            </span>
            <span style={{ minWidth: 0 }}>{feat}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The Companion "area" — the visible unlocked-vs-locked difference for the demo.
// Companion members see each capability marked "included ✓"; free members see a
// calm locked state (muted, "Included with Companion") + the Upgrade CTA. No
// shaming, no urgency — just a clear, gentle difference the client can point at.
function CompanionArea({ companionTier, isCompanion, onUpgrade, checkoutBusy, comingSoon, onOpenBestFits }) {
  const features = companionTier?.features || [];
  return (
    <div
      style={{
        ...cardStyle,
        border: isCompanion ? `1px solid ${t.green300}` : `1px solid ${t.cardBorder}`,
        background: isCompanion ? t.green50 : t.surface,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontFamily: t.serif, fontSize: 19, fontWeight: 700, color: t.text, minWidth: 0 }}>
          {isCompanion ? "You're on Spectrum Companion" : "What Companion adds"}
        </h3>
        {isCompanion && <CompanionBadge small />}
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 14, color: t.textSoft, lineHeight: 1.55 }}>
        {isCompanion
          ? "These extras are unlocked for you. Companion only ever adds comfort and capability — it never gates matching, messaging, or safety."
          : "Companion adds comfort and capability on top of everything you already have for free. Matching, messaging, safety, and seeing who likes you always stay free."}
      </p>

      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
        {features.map((feat, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              fontSize: 14,
              lineHeight: 1.5,
              color: isCompanion ? t.text : t.textMuted,
              minWidth: 0,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                fontWeight: 700,
                color: isCompanion ? t.accentStrong : t.textMuted,
              }}
            >
              {isCompanion ? "✓" : "◦"}
            </span>
            <span style={{ minWidth: 0 }}>
              {feat}
              {!isCompanion && (
                <span style={{ display: "block", fontSize: 12, color: t.textMuted, marginTop: 2 }}>
                  Included with Companion
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {/* "Top Picks" — the first implemented Companion surface. A clear entry
          from the Companion area: Companion members open the live shortlist; free
          members land on its calm locked state. No urgency, no counter. */}
      {onOpenBestFits && (
        <div style={{ marginTop: 18 }}>
          {isCompanion ? (
            <PrimaryButton onClick={onOpenBestFits}>Open your Top Picks</PrimaryButton>
          ) : (
            <QuietButton onClick={onOpenBestFits}>See “Top Picks”</QuietButton>
          )}
        </div>
      )}

      {!isCompanion && (
        <div style={{ marginTop: 18 }}>
          <PrimaryButton onClick={onUpgrade} disabled={checkoutBusy}>
            {checkoutBusy ? "One moment…" : "Upgrade to Companion"}
          </PrimaryButton>
          {comingSoon && (
            <p
              role="status"
              style={{
                margin: "12px 0 0",
                fontSize: 14,
                color: t.textSoft,
                lineHeight: 1.55,
                background: t.surfaceAlt,
                border: `1px solid ${t.borderLight}`,
                borderRadius: 12,
                padding: "12px 14px",
              }}
            >
              {COMING_SOON_NOTE}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function MembershipScreen({ onBack, tier: initialTier, onTierChange, onOpenBestFits }) {
  const [tiers, setTiers] = useState([]);
  const [entitlement, setEntitlement] = useState(
    initialTier ? { tier: initialTier, status: "active", source: "none" } : null
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [comingSoon, setComingSoon] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelDone, setCancelDone] = useState(false);
  const headingRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    return Promise.all([getBillingTiers(), getMyEntitlement()])
      .then(([catalog, ent]) => {
        setTiers(Array.isArray(catalog) ? catalog : []);
        setEntitlement(ent);
        if (typeof onTierChange === "function") onTierChange(ent.tier);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [onTierChange]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const handleUpgrade = useCallback(async () => {
    setCheckoutBusy(true);
    setCheckoutError("");
    setComingSoon(false);
    try {
      const res = await startCheckout("companion");
      // Stub provider → { configured: false }. We NEVER fabricate a checkout:
      // any non-configured result shows the calm "coming soon" note.
      if (res && res.configured) {
        // Future: a real provider returns a checkout URL to hand off to.
        if (res.url) { window.location.href = res.url; return; }
      }
      setComingSoon(true);
    } catch (err) {
      setCheckoutError(safeErrorMessage(err, "We couldn't do that just now. Please try again."));
    } finally {
      setCheckoutBusy(false);
    }
  }, []);

  const handleCancel = useCallback(async () => {
    setCancelBusy(true);
    setCancelError("");
    try {
      await cancelSubscription();
      setCancelDone(true);
      await load();
    } catch (err) {
      setCancelError(safeErrorMessage(err, "We couldn't do that just now. Please try again."));
    } finally {
      setCancelBusy(false);
    }
  }, [load]);

  const page = {
    minHeight: "100%",
    background: t.bgGradient,
    color: t.text,
    fontFamily: t.sans,
    fontSize: 16,
    lineHeight: 1.6,
    padding: "20px 16px 48px",
    boxSizing: "border-box",
  };
  const shell = { maxWidth: t.layout.maxContent, margin: "0 auto" };

  const isCompanion = entitlement?.tier === "companion";
  const isDemoGrant = entitlement?.source === "admin_demo";
  const freeTier = tiers.find((x) => x.id === "free") || null;
  const companionTier = tiers.find((x) => x.id === "companion") || null;

  return (
    <div style={page}>
      <div style={shell}>
        <BackButton onClick={onBack} />

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "18px 0 6px" }}>
          <h1
            ref={headingRef}
            tabIndex={-1}
            style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, margin: 0, color: t.text, outline: "none" }}
          >
            Membership
          </h1>
          {isCompanion && <CompanionBadge />}
        </div>
        <p style={{ margin: "0 0 8px", fontSize: 16, color: t.textSoft, lineHeight: 1.6 }}>
          Spectrum is free forever — safety, accessibility, matching, messaging, and
          seeing who likes you never cost anything. Companion is one optional plan
          that adds comfort and capability on top.
        </p>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: t.textMuted, lineHeight: 1.6 }}>
          One honest published price. No countdowns, no fake discounts, no pressure.
          You can cancel in one tap.
        </p>

        {loading ? (
          <p style={{ fontSize: 15, color: t.textMuted }}>Loading membership…</p>
        ) : loadError ? (
          <div style={cardStyle}>
            <p style={{ margin: "0 0 12px", fontSize: 15, color: t.text }}>
              We couldn't load membership details just now.
            </p>
            <QuietButton onClick={load}>Try again</QuietButton>
          </div>
        ) : (
          <>
            {/* Companion member: current status + Manage/Cancel */}
            {isCompanion && (
              <div style={{ ...cardStyle, marginBottom: 20, background: t.green50, border: `1px solid ${t.green300}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                  <h2 style={{ margin: 0, fontFamily: t.serif, fontSize: 20, fontWeight: 700, color: t.text, minWidth: 0 }}>
                    You're on Spectrum Companion
                  </h2>
                  <CompanionBadge small />
                </div>
                <p style={{ margin: "0 0 14px", fontSize: 14, color: t.textSoft, lineHeight: 1.55 }}>
                  Thank you for supporting Spectrum. You can manage or cancel anytime —
                  cancelling keeps everything in the free plan; nothing about matching,
                  messaging, or safety changes.
                </p>
                {isDemoGrant && (
                  <p style={{ margin: "0 0 14px", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
                    This Companion access was granted as a demo (not a paid subscription).
                  </p>
                )}
                <QuietButton onClick={handleCancel} disabled={cancelBusy}>
                  {cancelBusy ? "Working…" : "Manage / Cancel"}
                </QuietButton>
                {cancelError && (
                  <p role="alert" style={{ margin: "12px 0 0", fontSize: 14, color: t.danger, lineHeight: 1.5 }}>
                    {cancelError}
                  </p>
                )}
              </div>
            )}

            {cancelDone && !isCompanion && (
              <p role="status" style={{ margin: "0 0 20px", fontSize: 14, color: t.accentStrong, lineHeight: 1.55, background: t.green50, border: `1px solid ${t.green300}`, borderRadius: 12, padding: "12px 14px" }}>
                You're now on Spectrum (Free). Everything you use every day stays exactly the same.
              </p>
            )}

            {/* Both tiers side-by-side / stacked with feature lists + honest price */}
            <h2 style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 600, margin: "0 2px 12px", color: t.text }}>
              Plans
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 14,
                alignItems: "stretch",
                marginBottom: 28,
              }}
            >
              {freeTier && <TierCard tier={freeTier} current={!isCompanion} />}
              {companionTier && <TierCard tier={companionTier} current={isCompanion} />}
            </div>

            {/* The visible unlocked-vs-locked Companion area (the demo difference) */}
            {companionTier && (
              <>
                <h2 style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 600, margin: "0 2px 12px", color: t.text }}>
                  Companion
                </h2>
                <CompanionArea
                  companionTier={companionTier}
                  isCompanion={isCompanion}
                  onUpgrade={handleUpgrade}
                  checkoutBusy={checkoutBusy}
                  comingSoon={comingSoon}
                  onOpenBestFits={onOpenBestFits}
                />
                {checkoutError && (
                  <p role="alert" style={{ margin: "12px 2px 0", fontSize: 14, color: t.danger, lineHeight: 1.5 }}>
                    {checkoutError}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
