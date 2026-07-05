import { t } from "./tokens.js";
import { useFocusable } from "./useFocusable.js";

// ─── Audio prompt answer — FREE playback + transcript display ─────────────────
// The read side of audio prompt answers, shared by the owner's "How others see
// you" preview and the matched-profile view. Calm-by-design (mirrors the
// data-prompt-card look): the prompt is a quiet eyebrow, a native
// <audio preload="none" controls> player (no autoplay, no waveform, no counters),
// and the member-typed transcript shown as TEXT beneath — the transcript is the
// a11y floor and is ALWAYS visible, never hidden behind play. Playback + the
// transcript are free to every viewer; recording is the Companion-gated side and
// lives in AudioAnswerEditor.jsx.

// durationMs → a plain "m:ss" label (e.g. 42000 → "0:42"). Returns "" when absent
// so the label simply doesn't render — no "0:00" noise on an unknown duration.
export function formatAudioDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "";
  const totalSec = Math.round(durationMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// The quiet "Report this voice note" affordance. Its own component so the
// useFocusable hook order stays stable regardless of how many cards render
// (React #310 house rule). Rendered only when the card is given an onReport.
function ReportVoiceNoteButton({ onReport, promptText }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onReport}
      aria-label={`Report this voice note${promptText ? `: ${promptText}` : ""}`}
      {...f}
      style={{
        alignSelf: "flex-start",
        marginTop: 4,
        minHeight: 36,
        padding: "6px 10px",
        borderRadius: 8,
        border: "none",
        background: "transparent",
        color: t.textMuted,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: t.sans,
        cursor: "pointer",
        ...f.style,
      }}
    >
      Report this voice note
    </button>
  );
}

// One approved audio answer. `promptText` is the resolved prompt copy (falls back
// to nothing rather than a raw key). `url` is a playable clip URL; `transcript`
// is the required member-typed text. `onReport` (optional) shows the report
// affordance — omitted on the owner's own preview.
export default function AudioAnswerCard({ promptText, url, transcript, durationMs, onReport }) {
  const durLabel = formatAudioDuration(durationMs);
  return (
    <div
      data-audio-answer
      style={{
        border: `1px solid ${t.borderLight}`,
        borderRadius: 12,
        padding: "14px 16px",
        background: t.surfaceAlt,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      {promptText && (
        <p style={{
          margin: 0,
          minWidth: 0,
          fontSize: 13,
          fontWeight: 600,
          color: t.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          lineHeight: 1.4,
        }}>
          {promptText}
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
        {/* Native controls — accessible + keyboard-operable for free. preload
            "none" so opening a profile never auto-fetches every clip's bytes. */}
        <audio
          preload="none"
          controls
          src={url}
          aria-label={`Voice answer${promptText ? ` to: ${promptText}` : ""}`}
          style={{ maxWidth: "100%", minWidth: 0 }}
        />
        {durLabel && (
          <span style={{ fontSize: 13, color: t.textMuted, flexShrink: 0 }}>{durLabel}</span>
        )}
      </div>

      {/* Transcript — the a11y floor. Always visible as text, never behind play. */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 4 }}>
          Transcript
        </div>
        <p style={{ margin: 0, fontSize: 15, color: t.text, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {transcript}
        </p>
      </div>

      {onReport && <ReportVoiceNoteButton onReport={onReport} promptText={promptText} />}
    </div>
  );
}
