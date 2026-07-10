import { t } from "./tokens.js";
import { GenericError } from "./illustrations.jsx";
import Button from "./Button.jsx";
import { useReducedSensory } from "./ReducedSensoryContext.jsx";

// A calm, centered load-failure state. Pairs the GenericError glyph with a
// serif title and soft message, plus an optional "Try again" action. Used for
// the bare-text "Couldn't load…" branches across screens so failures feel
// gentle and consistent rather than abrupt.
//
// Props:
//   title    — serif heading (default "Something went wrong")
//   message  — supporting copy in textSoft
//   onRetry  — when provided, renders a secondary "Try again" Button
export default function ErrorState({ title = "Something went wrong", message, onRetry }) {
  // Low stimulation: drop the decorative GenericError glyph (and its spacer) so
  // the failure is a calm text-only state. The heading + message still carry all
  // the meaning. Global via context so no caller has to thread the prop.
  const reducedSensory = useReducedSensory();
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "32px 24px",
        maxWidth: 380,
        margin: "0 auto",
      }}
    >
      {!reducedSensory && (
        <div style={{ marginBottom: 16 }}>
          <GenericError size={80} />
        </div>
      )}
      <h2
        style={{
          fontFamily: t.serif,
          fontSize: 20,
          fontWeight: 700,
          color: t.text,
          margin: "0 0 8px",
          lineHeight: 1.3,
        }}
      >
        {title}
      </h2>
      {message && (
        <p style={{ color: t.textSoft, fontSize: 16, lineHeight: 1.6, margin: 0 }}>
          {message}
        </p>
      )}
      {onRetry && (
        <div style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
