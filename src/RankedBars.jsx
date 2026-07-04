import { t } from "./tokens.js";
import { barFraction } from "./chartMath.js";

// Horizontal ranked bars — one calm bar per row, width ∝ count/max, a single
// accent fill from tokens, and a right-aligned count label. STATIC (no
// animation). Reused for geo, referrers, and member email-domains. Rows are
// [{ label, count }]; `max` overrides the auto-peak when callers want a shared
// scale. The label cell and the row are flex with minWidth:0 (house rule) so a
// long label truncates with an ellipsis instead of overflowing the row.
export default function RankedBars({ rows, max, emptyLabel = "No data yet." }) {
  const list = Array.isArray(rows) ? rows : [];

  if (list.length === 0) {
    return <p style={{ margin: 0, fontSize: 14, color: t.textMuted }}>{emptyLabel}</p>;
  }

  const peak = max ?? Math.max(...list.map((r) => Number(r.count) || 0), 1);

  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
      {list.map((r, i) => {
        const count = Number(r.count) || 0;
        const frac = barFraction(count, peak);
        // Give any non-zero count a visible sliver even at tiny fractions.
        const widthPct = count > 0 ? Math.max(frac * 100, 2) : 0;
        return (
          <li key={r.label ?? i} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span
              title={r.label}
              style={{
                flex: "0 0 34%", minWidth: 0, fontSize: 14, color: t.textSoft,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {r.label || "—"}
            </span>
            <span
              aria-hidden="true"
              style={{ flex: 1, minWidth: 0, height: 12, background: t.surfaceAlt, borderRadius: 6, overflow: "hidden" }}
            >
              <span style={{ display: "block", width: `${widthPct}%`, height: "100%", background: t.accentFill, borderRadius: 6 }} />
            </span>
            <span
              style={{
                flex: "0 0 auto", fontSize: 13, color: t.textMuted,
                fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "right",
              }}
            >
              {count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
