// Community Standards — the single source of truth behind BOTH the Terms of
// Service §4 (the human rulebook) and the moderation console's AUTO-FILL.
//
// The promise in ToS §5 is that enforcement is RULE-based, not mood-based. So a
// report's `reason` resolves to exactly one clause here, and the console can
// pre-select the suggested action AND pre-fill the exact member-facing notice
// (which cites the ToS section) — the moderator confirms with one tap instead of
// writing a response to every report. A human still decides every action; the
// automation removes the WRITING, not the deciding. A moderator can always type
// their own reason to override the auto-fill when a case genuinely needs it.
//
// `notice` is composed per-ACTION (a warn reads "received a warning", a ban reads
// "removed") so the same clause produces the correct copy whichever rung of the
// ladder the moderator confirms. `final` clauses (minors) skip the appeal line.
//
// The reporter-facing SAFETY_REASONS values map 1:1 to these ids; 'minor_safety'
// and 'off_platform_harm' are the severe clauses (immediate removal + legal
// referral) that a "Safety concern" report or an admin re-map routes to.

export const COMMUNITY_STANDARDS = [
  {
    id: 'harassment',
    tosSection: '4.1',
    title: 'Respect',
    summary: "Harassment, threats, slurs, or pressuring someone after they've stepped back isn't allowed on Spectrum.",
    defaultAction: 'warn',
    escalateTo: 'ban',
  },
  {
    id: 'inappropriate',
    tosSection: '4.2',
    title: 'Appropriate content',
    summary: "Sexually explicit, graphic, or hateful content — and any unsolicited sexual image — isn't allowed on Spectrum.",
    defaultAction: 'warn',
    escalateTo: 'ban',
  },
  {
    id: 'fake_profile',
    tosSection: '4.3',
    title: 'Authenticity',
    summary: 'Profiles must honestly represent you — no impersonation, stolen photos, or catfishing.',
    defaultAction: 'warn',
    escalateTo: 'ban',
  },
  {
    id: 'spam',
    tosSection: '4.4',
    title: 'No spam or scams',
    summary: "Bulk or repetitive messaging, advertising, requests for money, and investment pitches aren't allowed on Spectrum.",
    defaultAction: 'warn',
    escalateTo: 'ban',
  },
  {
    id: 'minor_safety',
    tosSection: '4.5',
    title: 'Protection of minors',
    summary: 'Spectrum is strictly for adults, and we have a zero-tolerance policy for anything that involves a minor.',
    defaultAction: 'ban',
    escalateTo: 'ban',
    final: true,          // permanent; the notice omits the appeal line
    legalReferral: true,  // flags the CSAM/NCMEC + law-enforcement follow-up
  },
  {
    id: 'off_platform_harm',
    tosSection: '4.6',
    title: 'No off-platform harm',
    summary: 'Using Spectrum to organize or carry out real-world harm, harassment around a block, or illegal activity isn’t allowed.',
    defaultAction: 'ban',
    escalateTo: 'ban',
  },
  {
    id: 'other',
    tosSection: '4.7',
    title: 'Something else',
    summary: '',
    defaultAction: 'dismiss',
    escalateTo: 'warn',
    requiresHumanReason: true, // no auto notice — a person reads and writes this one
  },
];

const BY_ID = new Map(COMMUNITY_STANDARDS.map((c) => [c.id, c]));
const OTHER = BY_ID.get('other');
export const DEFAULT_SUPPORT_EMAIL = 'support@spectrum-dating.app';

// A report's reason value → its clause (falls back to the catch-all 'other').
export function standardForReason(reasonValue) {
  return BY_ID.get(reasonValue) || OTHER;
}

// The action the console pre-selects: escalate to the harsher rung when the
// member already carries a prior warning; otherwise the clause default. 'other'
// never suggests a punishment (a human reads it).
export function suggestedAction(clause, priorWarnCount = 0) {
  if (!clause || clause.requiresHumanReason) return 'dismiss';
  return priorWarnCount > 0 && clause.escalateTo ? clause.escalateTo : clause.defaultAction;
}

// The member-facing enforcement notice for a clause + confirmed action. Empty
// string when nothing should be auto-written (a dismiss records no member notice;
// 'other' requires a human reason). {support} is interpolated.
export function buildNotice(clause, action, { support = DEFAULT_SUPPORT_EMAIL } = {}) {
  if (!clause || clause.requiresHumanReason || action === 'dismiss') return '';
  const cite = `our Community Standard on ${clause.title} (Terms §${clause.tosSection})`;
  const appeal = clause.final ? ' This decision is final.' : ` If you believe this was a mistake, reply to ${support} and we'll take a look.`;
  if (action === 'warn') {
    return `Your account received a warning under ${cite}. ${clause.summary} Please take care here — continued behavior like this can lead to removal.${appeal}`;
  }
  // action === 'ban'
  const removed = clause.final ? 'permanently removed' : 'removed';
  return `Your account has been ${removed} under ${cite}. ${clause.summary}${appeal}`;
}

// Convenience for the report serializer: the full auto-fill packet the console
// needs to pre-select the action and pre-fill the notice.
export function suggestionForReport(reasonValue, priorWarnCount = 0, opts = {}) {
  const clause = standardForReason(reasonValue);
  const action = suggestedAction(clause, priorWarnCount);
  return {
    tosSection: clause.tosSection,
    title: clause.title,
    action,
    requiresHumanReason: !!clause.requiresHumanReason,
    legalReferral: !!clause.legalReferral,
    notice: buildNotice(clause, action, opts),
  };
}
