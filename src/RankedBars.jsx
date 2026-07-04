import { t } from "./tokens.js";
import { barFraction } from "./chartMath.js";
import { useFocusable } from "./useFocusable.js";

// Horizontal ranked bars — one calm bar per row, width ∝ count/max, a single
// accent fill from tokens, and a right-aligned count label. STATIC (no
// animation). Reused for geo, referrers, member email-domains, and the
// Population demographics report. Rows are [{ label, count }]; `max` overrides
// the auto-peak when callers want a shared scale. The label cell and the row are
// flex with minWidth:0 (house rule) so a long label truncates with an ellipsis
// instead of overflowing the row.
//
// Population extensions (backward compatible — plain [{label,count}] rows are
// unchanged):
//   • r.masked === true  → the exact count is withheld (k-anonymity, count is
//     null); the row shows "<5" and a small fixed sliver (its true width, 1–4,
//     is never revealed).
//   • onSelect + r.value → the row becomes a real <button> that calls
//     onSelect(r) (drill into the pre-filtered member list). A row is selectable
//     only when it carries a non-empty `value` (so synthetic "Not specified" /
//     "Open to everyone" / "Other" buckets stay non-interactive).

// A masked bucket (count 1–4) renders as a small fixed sliver — a CONSTANT
// width, so nothing about the true 1–4 value can be inferred from the bar.
const MASKED_WIDTH_PCT = 6;

function RankedBarRow({ row, peak, onSelect, ariaAction }) {
  const f = useFocusable();
  const count = Number(row.count) || 0;
  const masked = row.masked === true;
  const frac = barFraction(count, peak);
  const widthPct = masked ? MASKED_WIDTH_PCT : (count > 0 ? Math.max(frac * 100, 2) : 0);
  const countLabel = masked ? "<5" : count;
  const selectable = typeof onSelect === "function"
    && row.value !== undefined && row.value !== null && row.value !== "";

  const inner = (
    <>
      <span
        title={row.label}
        style={{
          flex: "0 0 34%", minWidth: 0, fontSize: 14, color: selectable ? t.accentStrong : t.textSoft,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left",
        }}
      >
        {row.label || "—"}
      </span>
      <span
        aria-hidden="true"
        style={{ flex: 1, minWidth: 0, height: 12, background: t.surfaceAlt, borderRadius: 6, overflow: "hidden" }}
      >
        <span style={{ display: "block", width: `${widthPct}%`, height: "100%", background: t.accentFill, borderRadius: 6, opacity: masked ? 0.55 : 1 }} />
      </span>
      <span
        style={{
          flex: "0 0 auto", fontSize: 13, color: t.textMuted,
          fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "right",
        }}
      >
        {countLabel}
      </span>
    </>
  );

  const rowStyle = { display: "flex", alignItems: "center", gap: 10, minWidth: 0, width: "100%" };

  if (selectable) {
    return (
      <li style={{ minWidth: 0 }}>
        <button
          type="button"
          onClick={() => onSelect(row)}
          aria-label={`${ariaAction ? `${ariaAction}: ` : ""}${row.label}${masked ? " (fewer than 5)" : `, ${count}`}`}
          style={{
            ...rowStyle, background: "transparent", border: "none", padding: "2px 0",
            cursor: "pointer", font: "inherit", ...f.style,
          }}
          onFocus={f.onFocus}
          onBlur={f.onBlur}
        >
          {inner}
        </button>
      </li>
    );
  }

  return (
    <li style={{ ...rowStyle }}>
      {inner}
    </li>
  );
}

export default function RankedBars({ rows, max, emptyLabel = "No data yet.", onSelect, ariaAction }) {
  const list = Array.isArray(rows) ? rows : [];

  if (list.length === 0) {
    return <p style={{ margin: 0, fontSize: 14, color: t.textMuted }}>{emptyLabel}</p>;
  }

  const peak = max ?? Math.max(...list.map((r) => Number(r.count) || 0), 1);

  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
      {list.map((r, i) => (
        <RankedBarRow key={r.label ?? i} row={r} peak={peak} onSelect={onSelect} ariaAction={ariaAction} />
      ))}
    </ul>
  );
}
