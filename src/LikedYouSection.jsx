import { t } from "./tokens.js";
import Avatar from "./Avatar.jsx";
import Button from "./Button.jsx";
import Spectrum from "./Spectrum.jsx";

// ─── Liked-you section ────────────────────────────────────────────────────────

// People who have liked you (one-sided, no mutual match yet). This is where you
// ACT on them, calmly and at your own pace. Because they already like you,
// "I'm interested" completes the mutual match immediately (previously this sent
// you to Discover, which never surfaced the liker — a dead end). "Not right now"
// declines quietly, and each person can be blocked or reported. No swipe stack,
// no counters, no urgency.
export default function LikedYouSection({ people, plainLanguage = false, busyId, onInterested, onNotNow, onReport }) {
  if (!people || people.length === 0) return null;
  const linkStyle = {
    background: "none",
    border: "none",
    padding: "8px 4px",
    minHeight: 44,
    fontSize: 14,
    fontWeight: 600,
    color: t.textMuted,
    cursor: "pointer",
    fontFamily: t.sans,
  };
  return (
    <section aria-labelledby="liked-you-heading" style={{ marginBottom: 28 }}>
      <h2
        id="liked-you-heading"
        style={{ fontFamily: t.serif, fontSize: 18, fontWeight: 600, color: t.text, margin: "0 0 6px" }}
      >
        Liked you
      </h2>
      <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 14px" }}>
        {people.length === 1 ? "1 person has" : `${people.length} people have`} said they're interested in you.
        {plainLanguage
          ? " If you're interested too, say so and you'll match."
          : " If you feel the same, say you're interested — you'll match and can start chatting. There's no rush."}
      </p>
      <ul aria-label="People who liked you" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {people.map((person) => {
          const busy = busyId === person.userId;
          const name = person.displayName || "Someone";
          return (
            <li key={person.userId} style={{ marginBottom: 12 }}>
              <div
                style={{
                  background: t.surface,
                  border: `1px solid ${t.cardBorder}`,
                  borderRadius: 16,
                  padding: "14px 16px",
                  boxShadow: t.shadow.sm,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Avatar name={person.displayName} userId={person.userId} photoUrl={person.photoUrl} size={52} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {name}
                    </div>
                    {person.age && <div style={{ fontSize: 14, color: t.textMuted }}>{person.age}</div>}
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => onInterested(person)}
                    disabled={busy}
                    aria-label={`I'm interested in ${name}`}
                    style={{ flexShrink: 0, cursor: busy ? "wait" : undefined }}
                  >
                    {busy ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <Spectrum variant="loader" size={6} gap={3} />
                        …
                      </span>
                    ) : (plainLanguage ? "Yes" : "I'm interested")}
                  </Button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginLeft: 66 }}>
                  <button type="button" style={linkStyle} disabled={busy} onClick={() => onNotNow(person)}>
                    Not right now
                  </button>
                  <span aria-hidden="true" style={{ color: t.borderLight }}>·</span>
                  <button type="button" style={linkStyle} onClick={() => onReport(person)}>
                    Block or report
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
