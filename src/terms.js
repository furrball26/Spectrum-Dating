// Spectrum Dating — Terms of Service, as structured content.
//
// This is the SINGLE SOURCE the in-app Terms screen renders. The words are
// transcribed faithfully from /TERMS_OF_SERVICE.md (repo root) — the published,
// binding text. The internal "Note for the Spectrum team" block from the doc is
// deliberately NOT included here (it is not part of the published Terms).
//
// Keeping it as data (not runtime-parsed markdown) lets TermsScreen render calm,
// accessible, token-styled sections without shipping a markdown parser.

export const TERMS_UPDATED = "2026-07-05";
export const TERMS_UPDATED_NOTE = "Plain-language, and we mean it.";

// The short-version summary box up top. A summary, not the binding rules.
export const TERMS_SHORT = {
  heading: "The short version",
  note: "This box is a summary, not the rules.",
  intro:
    "Spectrum Dating is a calm, safety-first dating app built for and with autistic adults. We make you three promises and ask you for a few in return.",
  groups: [
    {
      heading: "Our promises to you",
      items: [
        "We will never use dark patterns on you: no streaks, no countdowns, no “someone’s waiting!”, no read receipts, no online/last-seen, no fake activity counts, no engagement tricks. Calm is a feature, not a phase.",
        "Your location stays coarse (a general area, never a precise point).",
        "Your identity themes are yours — private to your device and reset when you log out. We never out anyone.",
        "A person reviews every photo and voice clip before anyone else can see it.",
        "If we ever act on your account, we’ll tell you exactly which rule and why, and give you a way to reply.",
      ],
    },
    {
      heading: "What we ask of you",
      items: [
        "Be 18 or older, be real, and treat people the way this community deserves.",
        "Follow the Community Standards in Section 4 — that’s the whole rulebook.",
      ],
    },
  ],
  outro:
    "The sections below are the binding terms. If anything here is unclear, email support@spectrum-dating.app and we’ll explain it in plainer words.",
};

// The numbered, binding sections. Each section may carry: `intro` (lead
// paragraph), `paragraphs` (array of <p>), `bullets` (array of <li>), and — for
// Section 4 only — `clauses` (each a labelled Community Standard with its usual
// consequence).
export const TERMS_SECTIONS = [
  {
    n: "1",
    title: "Who we are and what this is",
    paragraphs: [
      "Spectrum Dating (“Spectrum”, “we”, “us”) is a dating and connection service designed around the needs of autistic adults: predictable, low-sensory, low-pressure, and safe. Using the app means you agree to these Terms and to our Privacy practices (Section 6).",
      "We describe how the product behaves in Section 1 because those behaviors are commitments, not marketing. We will not quietly add gamification, urgency mechanics, fabricated metrics, precise-location sharing, typing indicators, read receipts, or online-status to pressure you into using the app more. If we ever change a core promise, we’ll say so plainly before it takes effect (Section 10).",
    ],
  },
  {
    n: "2",
    title: "Who can use Spectrum",
    bullets: [
      "You must be at least 18 years old. Spectrum is strictly for adults.",
      "You may hold one account, and the information on it must be truthful (your real self — you can share as much or as little as you like, but not pretend to be someone you’re not).",
      "You must have the legal capacity to agree to these Terms where you live.",
      "You must not be barred from our service by a prior permanent removal.",
    ],
  },
  {
    n: "3",
    title: "Your account and your safety",
    bullets: [
      "Keep your login details private; you’re responsible for activity on your account. Tell us at once if you think someone else has access.",
      "You are always in control of your data. You can pause your profile, edit or delete anything, export a full copy of your data, or delete your account entirely, at any time, from Settings.",
      "Dating carries real-world risk. Spectrum is not a background-check service and does not verify criminal history. Meet in public, tell a friend, and trust your instincts. Our Safety Center has more.",
    ],
  },
  {
    n: "4",
    title: "Community Standards (the rulebook)",
    intro:
      "These are the rules. They exist to keep this a safe, calm place. Every moderation decision we make maps to one of the clauses below — so enforcement is consistent and predictable, never based on who reviewed your report or what kind of day they were having. Each clause lists the usual consequence; serious or repeat violations move up the ladder (Section 5).",
    clauses: [
      {
        id: "§4.1",
        title: "Respect (no harassment or abuse).",
        body:
          "Treat people with basic dignity. No harassment, threats, hate speech, slurs, demeaning messages, or pressuring anyone after they’ve said no or gone quiet. Neurodivergent communication differs — assume good faith, but cruelty is never a “communication style.”",
        consequence: "Usual consequence: warning; repeat or severe → removal.",
      },
      {
        id: "§4.2",
        title: "Appropriate content.",
        body:
          "No sexually explicit, violent, gory, or hateful images or text. Never send unsolicited sexual images. Keep profile photos and voice clips something a stranger could safely encounter.",
        consequence:
          "Usual consequence: content removed + warning; explicit/graphic or repeat → removal.",
      },
      {
        id: "§4.3",
        title: "Be real (no impersonation or deception).",
        body:
          "Be yourself. No fake profiles, stolen photos, impersonating others, catfishing, or misrepresenting who you are to deceive.",
        consequence:
          "Usual consequence: warning + a chance to verify; clear fraud/impersonation → removal.",
      },
      {
        id: "§4.4",
        title: "No spam, scams, or solicitation.",
        body:
          "No bulk/repetitive messaging, advertising, phishing, requests for money, crypto or investment pitches, or driving people to other services. Romance scams are removed on sight.",
        consequence:
          "Usual consequence: warning; scams/financial fraud → immediate removal.",
      },
      {
        id: "§4.5",
        title: "Protection of minors (zero tolerance).",
        body:
          "Anyone under 18 is not permitted. Any sexual content involving minors, or any attempt to use Spectrum to reach a minor, results in immediate permanent removal and a report to law enforcement / NCMEC. There is no ladder here.",
        consequence:
          "Usual consequence: immediate permanent removal + legal referral.",
      },
      {
        id: "§4.6",
        title: "No off-platform harm or illegal activity.",
        body:
          "Don’t use Spectrum to organize, threaten, or carry out real-world harm, harassment that continues around a block, human trafficking, or other illegal conduct.",
        consequence:
          "Usual consequence: removal; severity-dependent legal referral.",
      },
      {
        id: "§4.7",
        title: "Something else.",
        body:
          "Conduct that undermines the safety or calm of the community but isn’t listed above. A person reviews these individually.",
        consequence:
          "Usual consequence: reviewed case-by-case; no automatic action.",
      },
    ],
  },
  {
    n: "5",
    title: "How moderation and enforcement work",
    intro:
      "We want you to know exactly how this works, because unpredictability is its own kind of harm.",
    bullets: [
      "Reporting is private and low-stakes. You can report someone without blocking them; they are never told who reported them.",
      "Consistency by design. When a report comes in, it is matched to the Community Standard it concerns (Section 4), and the standard consequence and the message you’d receive are prepared from that rule — so two identical situations are handled the same way. A human moderator reviews and confirms every action; nothing is auto-punished without a person deciding. A moderator can add a personal note when a situation genuinely needs one, but the rule — not the mood — sets the baseline.",
      "The enforcement ladder: (1) Warning — we tell you which standard and ask you to correct course; (2) Suspension — a temporary lock; (3) Permanent removal (ban) — for severe violations or repeat behavior after a warning. Section 4.5 (minors) skips the ladder.",
      "Due process. If we act on your account, you will always be shown which standard, in plain language, and a way to appeal by replying to support@spectrum-dating.app. We read appeals.",
      "Photos and voice clips are reviewed by a person before anyone else can see them. Content that breaks §4.2 or §4.5 is removed at that gate.",
    ],
  },
  {
    n: "6",
    title: "Your privacy and your data (summary; the Privacy Policy governs)",
    bullets: [
      "Coarse location only. We use a general area for distance and never share or store a precise point.",
      "Identity themes (including pride/trans themes) are client-side and private, and reset on logout. We never use them to out you.",
      "You can export or delete everything, anytime, from Settings. Deletion removes your profile and content; we keep the minimum required for safety and legal obligations (e.g. a record that a removed account was removed).",
      "We show only what’s needed to match and connect. We don’t sell your personal data.",
    ],
  },
  {
    n: "7",
    title: "Your content",
    paragraphs: [
      "You keep ownership of what you post. You grant us a limited licence to host and display it so the app can function (e.g. showing your photo to a match). You’re responsible for having the right to share what you post, and for it following Section 4.",
    ],
  },
  {
    n: "8",
    title: "Suspension, removal, and appeals",
    paragraphs: [
      "We may warn, suspend, or permanently remove an account that violates these Terms, following Section 5. We’ll tell you the standard involved and how to appeal. Permanent removal for a §4.5 violation or serious fraud/harm is not reversible. You may also close your own account at any time from Settings.",
    ],
  },
  {
    n: "9",
    title: "Disclaimers and limits",
    bullets: [
      "Spectrum helps you meet people; we don’t guarantee matches, replies, or outcomes, and we don’t screen members’ criminal or background history.",
      "The service is provided “as is.” To the extent the law allows, we’re not liable for interactions between members or for indirect damages. Nothing here limits rights you have that can’t be waived under your local law.",
    ],
  },
  {
    n: "10",
    title: "Changes to these Terms",
    paragraphs: [
      "If we make a material change — especially to a core promise in Section 1 or the Community Standards — we’ll notify you in the app before it takes effect and, where practical, explain what changed and why, in plain language.",
    ],
  },
  {
    n: "11",
    title: "Contact",
    paragraphs: [
      "Questions, appeals, or anything unclear: support@spectrum-dating.app. We’ll answer in plain words.",
    ],
  },
];
