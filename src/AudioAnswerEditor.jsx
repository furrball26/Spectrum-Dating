import { useState, useEffect, useRef, useCallback } from "react";
import { t } from "./tokens.js";
import { useFocusable } from "./useFocusable.js";
import {
  getMyAudio,
  getAudioUploadUrl,
  confirmAudioAnswer,
  getAudioPlaybackUrl,
  deleteAudioAnswer,
  safeErrorMessage,
} from "./api.js";
import { formatAudioDuration } from "./AudioAnswer.jsx";

// ─── Audio prompt answers — the RECORD + manage side (Companion-gated) ────────
// Lives inside the profile prompt editor. Calm-by-design and mirrors the photo
// pending pattern: record with MediaRecorder (≤60s, calm count-UP, no countdown),
// then a REQUIRED member-typed transcript, then upload to the presigned URL and
// confirm — after which the clip shows as "Pending review" until a moderator
// approves it. Recording is Companion; a free member sees a calm locked
// affordance (never pay-to-be-seen framing). Managing (play own / delete) stays
// available even after a downgrade — you can always remove your own content.
//
// Gating is authoritative on the BACKEND (402 upgrade_required); this UI lock is
// UX only. All React hooks sit before any early return, and every tappable that
// needs useFocusable is its own component (React #310 house rule).

const MAX_AUDIO = 3;               // matches the server ceiling
const MAX_DURATION_MS = 60_000;    // 60s cap (server rejects longer)
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const TRANSCRIPT_MAX = 2000;

// Pick a MediaRecorder mime that is BOTH recordable here AND on the backend
// allowlist (audio/webm, audio/mp4, audio/ogg). Returns null when this browser
// can't record — the caller falls back to text calmly.
function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return null;
  for (const m of ["audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

function canRecordAudio() {
  return (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    pickRecorderMime() !== null
  );
}

// ── Shared small pieces ───────────────────────────────────────────────────────

const badgeBase = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.01em",
};

function StatusBadge({ status }) {
  if (status === "pending_review") {
    return (
      <span style={{ ...badgeBase, color: t.textSoft, background: t.surfaceAlt, border: `1px solid ${t.border}` }}>
        Pending review
      </span>
    );
  }
  if (status === "approved") {
    return (
      <span style={{ ...badgeBase, color: t.positiveText, background: t.green50, border: `1px solid ${t.border}` }}>
        <span aria-hidden="true" style={{ marginRight: 4 }}>✓</span> On your profile
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span style={{ ...badgeBase, color: t.textSoft, background: t.surfaceAlt, border: `1px solid ${t.border}` }}>
        Not approved
      </span>
    );
  }
  return null;
}

function PrimaryButton({ children, onClick, disabled, ariaLabel, kind = "accent" }) {
  const f = useFocusable();
  const bg = disabled ? t.surfaceAlt : kind === "danger" ? t.dangerFill : t.accentFill;
  const color = disabled ? t.textMuted : "#fff";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      {...f}
      style={{
        minHeight: 44,
        padding: "10px 18px",
        borderRadius: 10,
        border: "none",
        background: bg,
        color,
        fontSize: 16,
        fontWeight: 600,
        fontFamily: t.sans,
        cursor: disabled ? "not-allowed" : "pointer",
        ...f.style,
      }}
    >
      {children}
    </button>
  );
}

function QuietButton({ children, onClick, disabled, ariaLabel }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      {...f}
      style={{
        minHeight: 44,
        padding: "10px 16px",
        borderRadius: 10,
        border: `1px solid ${t.formBorder}`,
        background: t.surface,
        color: t.textSoft,
        fontSize: 15,
        fontWeight: 600,
        fontFamily: t.sans,
        cursor: disabled ? "not-allowed" : "pointer",
        ...f.style,
      }}
    >
      {children}
    </button>
  );
}

// ── One of the member's own clips (play own + delete) ─────────────────────────
function OwnAudioRow({ clip, promptText, onDeleted }) {
  const [src, setSrc] = useState(clip.url || "");
  const [loadingSrc, setLoadingSrc] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fLoad = useFocusable();

  // A pending clip has no stable URL — fetch a short-lived presigned one on demand
  // (owner-or-admin only) so the owner can hear back what they recorded.
  const loadPlayback = useCallback(async () => {
    setLoadingSrc(true);
    setError("");
    try {
      const url = await getAudioPlaybackUrl(clip.id);
      if (url) setSrc(url);
      else setError("Couldn't load this recording. Please try again.");
    } catch (e) {
      setError(safeErrorMessage(e, "Couldn't load this recording. Please try again."));
    } finally {
      setLoadingSrc(false);
    }
  }, [clip.id]);

  async function doDelete() {
    setBusy(true);
    setError("");
    try {
      const next = await deleteAudioAnswer(clip.id);
      onDeleted(next);
    } catch (e) {
      setError(safeErrorMessage(e, "Couldn't delete this recording. Please try again."));
      setBusy(false);
    }
  }

  const durLabel = formatAudioDuration(clip.durationMs);

  return (
    <li
      style={{
        listStyle: "none",
        border: `1px solid ${t.borderLight}`,
        borderRadius: 12,
        padding: "14px 14px 12px",
        marginBottom: 12,
        background: t.surface,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
        <p style={{
          margin: 0, minWidth: 0, fontSize: 13, fontWeight: 600, color: t.textMuted,
          textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.4,
        }}>
          {promptText || "Voice answer"}
        </p>
        <StatusBadge status={clip.reviewStatus} />
      </div>

      {/* Playback: approved clips carry a URL; pending clips load one on demand. */}
      {src ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <audio preload="none" controls src={src} aria-label={`Your voice answer${promptText ? ` to: ${promptText}` : ""}`} style={{ maxWidth: "100%", minWidth: 0 }} />
          {durLabel && <span style={{ fontSize: 13, color: t.textMuted, flexShrink: 0 }}>{durLabel}</span>}
        </div>
      ) : (
        <button
          type="button"
          onClick={loadPlayback}
          disabled={loadingSrc}
          {...fLoad}
          style={{
            alignSelf: "flex-start", minHeight: 44, padding: "8px 14px", borderRadius: 10,
            border: `1px solid ${t.formBorder}`, background: t.surface, color: t.accentStrong,
            fontSize: 15, fontWeight: 600, fontFamily: t.sans, cursor: loadingSrc ? "wait" : "pointer", ...fLoad.style,
          }}
        >
          {loadingSrc ? "Loading…" : "Play your recording"}
        </button>
      )}

      {clip.reviewStatus === "pending_review" && (
        <p style={{ margin: 0, fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
          A member of our team will take a look before anyone else can hear it.
        </p>
      )}
      {clip.reviewStatus === "rejected" && (
        <p style={{ margin: 0, fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
          This one wasn't approved. You can delete it and record a new answer whenever you like.
        </p>
      )}

      {clip.transcript && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 4 }}>Transcript</div>
          <p style={{ margin: 0, fontSize: 15, color: t.text, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {clip.transcript}
          </p>
        </div>
      )}

      {error && <p role="alert" style={{ margin: 0, color: t.danger, fontSize: 14 }}>{error}</p>}

      {confirmDelete ? (
        <div role="group" aria-label="Confirm delete" style={{ display: "flex", flexDirection: "column", gap: 10, background: t.dangerSurface, border: `1px solid ${t.danger}`, borderRadius: 10, padding: "12px 14px" }}>
          <p style={{ margin: 0, fontSize: 15, color: t.text, lineHeight: 1.5 }}>Delete this voice answer? This can't be undone.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <PrimaryButton kind="danger" onClick={doDelete} disabled={busy} ariaLabel="Confirm delete voice answer">
              {busy ? "Deleting…" : "Delete"}
            </PrimaryButton>
            <QuietButton onClick={() => setConfirmDelete(false)} disabled={busy}>Keep it</QuietButton>
          </div>
        </div>
      ) : (
        <QuietButton onClick={() => setConfirmDelete(true)} ariaLabel={`Delete voice answer${promptText ? ` to: ${promptText}` : ""}`}>Delete</QuietButton>
      )}
    </li>
  );
}

// ── The recorder itself ───────────────────────────────────────────────────────
// phase: "idle" → choosing a prompt then "Start recording"
//        "recording" → capturing (calm count-up, Stop / auto-stop at 60s)
//        "review" → recorded blob + required transcript, Post / Re-record
function AudioRecorderPanel({ availablePrompts, onPosted, onCancel }) {
  const [phase, setPhase] = useState("idle");
  const [promptKey, setPromptKey] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [blob, setBlob] = useState(null);
  const [blobUrl, setBlobUrl] = useState("");
  const [recordMime, setRecordMime] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [micDenied, setMicDenied] = useState(false);
  const [posting, setPosting] = useState(false);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startAtRef = useRef(0);
  const tickRef = useRef(null);
  const blobUrlRef = useRef("");

  const fSelect = useFocusable();
  const supported = canRecordAudio();

  // Fully release the mic + timer + object URL. Safe to call repeatedly.
  const teardown = useCallback((keepBlobUrl) => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") { try { mr.stop(); } catch { /* already stopped */ } }
    mediaRecorderRef.current = null;
    const stream = streamRef.current;
    if (stream) { stream.getTracks().forEach((tr) => { try { tr.stop(); } catch { /* noop */ } }); }
    streamRef.current = null;
    if (!keepBlobUrl && blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = ""; }
  }, []);

  // Release everything on unmount.
  useEffect(() => () => teardown(false), [teardown]);

  async function startRecording() {
    if (!promptKey) return;
    setError("");
    setMicDenied(false);
    const mime = pickRecorderMime();
    if (!mime) { setError("This browser can't record audio here. You can answer with text instead."); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      // Denied / no device — never blame the member.
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError" || e.name === "PermissionDeniedError")) {
        setMicDenied(true);
      } else {
        setError("We couldn't reach your microphone. You can answer with text instead, or check your device and try again.");
      }
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    let mr;
    try {
      mr = new MediaRecorder(stream, { mimeType: mime });
    } catch {
      teardown(false);
      setError("This browser can't record audio here. You can answer with text instead.");
      return;
    }
    mediaRecorderRef.current = mr;
    setRecordMime(mime);
    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data); };
    mr.onstop = () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      const b = new Blob(chunksRef.current, { type: mime });
      // stop the mic tracks now that capture is done
      if (streamRef.current) { streamRef.current.getTracks().forEach((tr) => { try { tr.stop(); } catch { /* noop */ } }); streamRef.current = null; }
      const url = URL.createObjectURL(b);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = url;
      setBlob(b);
      setBlobUrl(url);
      setPhase("review");
    };
    startAtRef.current = Date.now();
    setElapsedMs(0);
    tickRef.current = setInterval(() => {
      const ms = Date.now() - startAtRef.current;
      setElapsedMs(ms);
      if (ms >= MAX_DURATION_MS) {
        // Calm auto-stop at the cap — a short answer, no countdown, no panic.
        try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
      }
    }, 200);
    mr.start();
    setPhase("recording");
  }

  function stopRecording() {
    try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
  }

  function reRecord() {
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = ""; }
    setBlob(null);
    setBlobUrl("");
    setTranscript("");
    setElapsedMs(0);
    setError("");
    setPhase("idle");
  }

  async function post() {
    if (!blob || !transcript.trim() || !promptKey) return;
    if (blob.size > MAX_FILE_SIZE) {
      setError("That recording is a little large to upload. Try a shorter answer.");
      return;
    }
    setPosting(true);
    setError("");
    const durationMs = Math.min(Math.max(1, Math.round(elapsedMs)), MAX_DURATION_MS);
    const mimeType = recordMime || pickRecorderMime() || "audio/webm";
    try {
      const up = await getAudioUploadUrl({ mimeType, fileSizeBytes: blob.size, durationMs });
      if (up.upgradeRequired) {
        setError("Voice answers are part of Spectrum Companion.");
        setPosting(false);
        return;
      }
      const put = await fetch(up.uploadUrl, { method: "PUT", headers: { "Content-Type": mimeType }, body: blob });
      if (!put.ok) throw new Error("Upload failed");
      const res = await confirmAudioAnswer({ key: up.key, promptKey, transcript: transcript.trim(), durationMs });
      if (res.upgradeRequired) {
        setError("Voice answers are part of Spectrum Companion.");
        setPosting(false);
        return;
      }
      teardown(false);
      onPosted(res.audio);
    } catch (e) {
      setError(safeErrorMessage(e, "We couldn't post your voice answer. Please try again."));
      setPosting(false);
    }
  }

  const panel = {
    border: `1px dashed ${t.formBorder}`,
    borderRadius: 12,
    padding: "16px 14px",
    marginBottom: 12,
    background: t.surface,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  };

  if (!supported) {
    return (
      <div style={panel}>
        <p style={{ margin: 0, fontSize: 15, color: t.textSoft, lineHeight: 1.6 }}>
          This browser can't record audio here — but you can still answer prompts with text.
        </p>
        <div><QuietButton onClick={onCancel}>Back</QuietButton></div>
      </div>
    );
  }

  return (
    <div style={panel} role="group" aria-label="Record a voice answer">
      {/* Consent + expectation-setting (record-time) */}
      <p style={{ margin: 0, fontSize: 14, color: t.textSoft, lineHeight: 1.6 }}>
        Answer a prompt in your own voice. Please only record yourself — not other
        people. Your clip is reviewed by our team before anyone can hear it, you'll
        add a written transcript so everyone can read it too, and you can delete it
        anytime.
      </p>

      {phase === "idle" && (
        <>
          <div>
            <label htmlFor="audio-prompt-select" style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 6 }}>
              Choose a prompt
            </label>
            <select
              id="audio-prompt-select"
              value={promptKey}
              onChange={(e) => setPromptKey(e.target.value)}
              {...fSelect}
              style={{
                width: "100%", minHeight: 44, borderRadius: 10, border: `1px solid ${t.formBorder}`,
                padding: "10px 12px", fontSize: 16, color: t.text, background: t.surface,
                fontFamily: t.sans, appearance: "auto", cursor: "pointer", boxSizing: "border-box", ...fSelect.style,
              }}
            >
              <option value="">Select a prompt…</option>
              {availablePrompts.map((p) => (
                <option key={p.key} value={p.key}>{p.text}</option>
              ))}
            </select>
          </div>

          {micDenied && (
            <p role="alert" style={{ margin: 0, fontSize: 14, color: t.textSoft, lineHeight: 1.6 }}>
              We couldn't reach your microphone — you may have declined access, which is
              completely fine. You can allow microphone access in your browser and try
              again, or answer this prompt with text instead.
            </p>
          )}
          {error && <p role="alert" style={{ margin: 0, fontSize: 14, color: t.danger, lineHeight: 1.5 }}>{error}</p>}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <PrimaryButton onClick={startRecording} disabled={!promptKey} ariaLabel="Start recording your voice answer">
              Start recording
            </PrimaryButton>
            <QuietButton onClick={onCancel}>Cancel</QuietButton>
          </div>
        </>
      )}

      {phase === "recording" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: "50%", background: t.accentFill, flexShrink: 0 }} />
            <span role="status" aria-live="polite" style={{ fontSize: 18, fontWeight: 700, color: t.text, fontVariantNumeric: "tabular-nums" }}>
              Recording · {formatAudioDuration(Math.max(1000, elapsedMs))}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: t.textMuted, lineHeight: 1.5 }}>
            Take your time — recordings can be up to a minute. Stop whenever you're ready.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <PrimaryButton onClick={stopRecording} ariaLabel="Stop recording">Stop</PrimaryButton>
          </div>
        </>
      )}

      {phase === "review" && (
        <>
          {blobUrl && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.textMuted, marginBottom: 6 }}>Listen back</div>
              <audio preload="none" controls src={blobUrl} aria-label="Your recording, before posting" style={{ maxWidth: "100%", minWidth: 0 }} />
            </div>
          )}

          <div>
            <label htmlFor="audio-transcript" style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 6 }}>
              Type what you said, so everyone can read it too — this is required
            </label>
            <textarea
              id="audio-transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value.slice(0, TRANSCRIPT_MAX))}
              rows={4}
              maxLength={TRANSCRIPT_MAX}
              placeholder="Write out your answer…"
              style={{
                width: "100%", border: `1px solid ${t.formBorder}`, borderRadius: 10, padding: "10px 12px",
                fontSize: 16, color: t.text, background: t.surface, resize: "vertical", minHeight: 96,
                fontFamily: t.sans, lineHeight: 1.55, boxSizing: "border-box",
              }}
            />
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}>
              {TRANSCRIPT_MAX - transcript.length} characters remaining
            </div>
          </div>

          {error && <p role="alert" style={{ margin: 0, fontSize: 14, color: t.danger, lineHeight: 1.5 }}>{error}</p>}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <PrimaryButton onClick={post} disabled={posting || !transcript.trim()} ariaLabel="Post your voice answer for review">
              {posting ? "Posting…" : "Post voice answer"}
            </PrimaryButton>
            <QuietButton onClick={reRecord} disabled={posting}>Re-record</QuietButton>
            <QuietButton onClick={() => { teardown(false); onCancel(); }} disabled={posting}>Cancel</QuietButton>
          </div>
        </>
      )}
    </div>
  );
}

// ── Free-tier locked affordance (record is Companion; NEVER pay-to-be-seen) ────
function LockedAudioUpsell({ onOpenMembership }) {
  const f = useFocusable();
  return (
    <div
      style={{
        background: t.surfaceAlt,
        border: `1px solid ${t.borderLight}`,
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: t.text, lineHeight: 1.5 }}>
        Voice answers are part of Spectrum Companion
      </p>
      <p style={{ margin: 0, fontSize: 14, color: t.textSoft, lineHeight: 1.6 }}>
        Answer a prompt in your own voice for the people who read you best. Everyone
        can still play and read voice answers for free — this just lets you add your own.
      </p>
      <button
        type="button"
        onClick={onOpenMembership}
        {...f}
        style={{
          alignSelf: "flex-start", minHeight: 44, padding: "10px 20px", borderRadius: 10,
          border: `1px solid ${t.accentStrong}`, background: "transparent", color: t.accentStrong,
          fontSize: 16, fontWeight: 600, fontFamily: t.sans, cursor: "pointer", ...f.style,
        }}
      >
        See what Companion adds
      </button>
    </div>
  );
}

// ── Public editor ─────────────────────────────────────────────────────────────
// promptCatalog: [{ key, text, ... }]; promptTextFor(key) → resolved copy.
export default function AudioAnswerEditor({ tier = "free", promptCatalog = [], promptTextFor, onOpenMembership }) {
  const isCompanion = tier === "companion";
  const [ownAudio, setOwnAudio] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const fAdd = useFocusable();

  useEffect(() => {
    let active = true;
    getMyAudio()
      .then((list) => { if (active) setOwnAudio(list); })
      .catch(() => { /* best-effort — the editor still offers the record/lock UI */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const resolveText = useCallback(
    (key) => (typeof promptTextFor === "function" ? promptTextFor(key) : key),
    [promptTextFor]
  );

  // Prompts the member hasn't already answered with a voice note.
  const usedKeys = new Set(ownAudio.map((a) => a.promptKey));
  const availablePrompts = promptCatalog.filter((p) => p && p.key && !usedKeys.has(p.key));
  const atCap = ownAudio.length >= MAX_AUDIO;

  const handleDeleted = useCallback((next) => setOwnAudio(next), []);
  const handlePosted = useCallback((next) => {
    setOwnAudio(Array.isArray(next) ? next : []);
    setRecording(false);
  }, []);

  return (
    <div style={{ marginTop: 4, marginBottom: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 4 }}>Answer with your voice</div>
      <p style={{ margin: "0 0 14px", fontSize: 14, color: t.textSoft, lineHeight: 1.6 }}>
        Some people come across better out loud. Record a short voice answer to a
        prompt — everyone can play it and read the transcript for free.
      </p>

      {!loading && ownAudio.length > 0 && (
        <ul style={{ margin: "0 0 4px", padding: 0 }}>
          {ownAudio.map((clip) => (
            <OwnAudioRow
              key={clip.id}
              clip={clip}
              promptText={resolveText(clip.promptKey)}
              onDeleted={handleDeleted}
            />
          ))}
        </ul>
      )}

      {isCompanion ? (
        recording ? (
          <AudioRecorderPanel
            availablePrompts={availablePrompts}
            onPosted={handlePosted}
            onCancel={() => setRecording(false)}
          />
        ) : atCap ? (
          <p style={{ margin: "4px 0 0", fontSize: 14, color: t.textMuted, lineHeight: 1.5 }}>
            That's the most voice answers you can add ({MAX_AUDIO}). Delete one to record another.
          </p>
        ) : availablePrompts.length === 0 ? (
          <p style={{ margin: "4px 0 0", fontSize: 14, color: t.textMuted, lineHeight: 1.5 }}>
            You've recorded a voice answer for every available prompt.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setRecording(true)}
            {...fAdd}
            style={{
              minHeight: 44, padding: "10px 16px", borderRadius: 10, border: `1px dashed ${t.formBorder}`,
              background: t.surface, color: t.accentStrong, fontSize: 15, fontWeight: 600,
              fontFamily: t.sans, cursor: "pointer", ...fAdd.style,
            }}
          >
            Answer with a voice note
          </button>
        )
      ) : (
        // Free member: managing existing clips stays available above; recording is
        // the calm locked door (never "get more matches with audio").
        <LockedAudioUpsell onOpenMembership={onOpenMembership} />
      )}
    </div>
  );
}
