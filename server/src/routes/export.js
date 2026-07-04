import { Router } from 'express';
import archiver from 'archiver';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth, verifyToken, signPurposeToken, verifyPurposeToken } from '../middleware/auth.js';
import { assembleOwnProfile } from './profile.js';
import { getObjectBytes, r2Configured } from '../storage/r2.js';
import { coarseLabel } from '../utils/time.js';

const router = Router();

// Low-ceiling limiter — exports are rare and expensive (O(convos×msgs) scan of
// the full corpus, plus fetching every photo's bytes out of R2). Keeps this from
// becoming a cheap PII-scrape / DoS amplifier. Keyed per-user (req.ctx.userId is
// set by optionalAuth/contextMiddleware); falls back to IP for the ?token= path
// before ctx is resolved.
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.ctx?.userId ? `u:${req.ctx.userId}` : ipKeyGenerator(req.ip)),
  message: { error: 'Too many export requests. Please wait a few minutes and try again.' },
});

// Resolve the requester for an export download. Accept, in order of preference:
//   1. An Authorization header (already resolved into req.ctx.userId).
//   2. A short-lived, purpose-scoped export token in ?token= (preferred for
//      browser download links that can't send custom headers).
//   3. (Legacy) a full session JWT in ?token= — still honored for backward
//      compatibility, but the export token above is the intended, low-blast-
//      radius mechanism.
// Returns the userId, or null after having already sent the 401 response.
function resolveExportUser(req, res) {
  let userId = req.ctx?.userId ?? null;
  if (!userId && req.query.token) {
    const purpose = verifyPurposeToken(req.query.token, 'export');
    if (purpose) {
      userId = purpose.sub;
    } else {
      // Legacy session-JWT fallback. verifyToken runs the same
      // version/suspension/existence check as requireAuth.
      userId = verifyToken(req.query.token);
    }
    if (!userId) {
      res.status(401).json({ error: 'Invalid token.' });
      return null;
    }
  }
  if (!userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  return userId;
}

// POST /export/token — mint a short-lived (5-minute), purpose-scoped export
// token. The browser download link then carries THIS token in the query string
// instead of the 30-day session JWT — so a leaked URL (proxy/CDN log, history,
// Referer) exposes at most a 5-minute, export-only credential, not a full
// account-takeover session token. Requires a normal Authorization header.
router.post('/token', requireAuth, exportLimiter, (req, res) => {
  const { db, userId } = req.ctx;
  const user = db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  const token = signPurposeToken(userId, 'export', user.token_version ?? 0, '5m');
  res.json({ token });
});

// ─── Data assembly ────────────────────────────────────────────────────────────

// Assemble the requester's conversations at the SAME privacy fidelity the export
// has always used: the requester's own messages/reactions in full; the OTHER
// party minimized to their display name + message direction (me/them); every
// timestamp coarsened to a day-group; deleted messages redacted to [deleted].
function buildConversations(db, userId) {
  const conversations = db.prepare(`
    SELECT c.id, c.user_a_id, c.user_b_id,
           pa.display_name AS name_a,
           pb.display_name AS name_b
    FROM conversations c
    LEFT JOIN profiles pa ON pa.user_id = c.user_a_id
    LEFT JOIN profiles pb ON pb.user_id = c.user_b_id
    WHERE c.user_a_id = ? OR c.user_b_id = ?
    ORDER BY c.created_at DESC
  `).all(userId, userId);

  return conversations.map((conv) => {
    const otherName = conv.user_a_id === userId ? conv.name_b : conv.name_a;

    // Fetch all messages including deleted ones
    const messages = db.prepare(`
      SELECT m.id, m.sender_id, m.body, m.deleted, m.sent_at
      FROM messages m
      WHERE m.conversation_id = ?
      ORDER BY m.sent_at ASC
    `).all(conv.id);

    // Fetch reactions the current user placed on any message in this conversation
    const userReactions = db.prepare(`
      SELECT mr.message_id, mr.emoji
      FROM message_reactions mr
      JOIN messages m ON m.id = mr.message_id
      WHERE m.conversation_id = ? AND mr.user_id = ?
    `).all(conv.id, userId);

    const reactionMap = {};
    for (const r of userReactions) {
      if (!reactionMap[r.message_id]) reactionMap[r.message_id] = [];
      reactionMap[r.message_id].push(r.emoji);
    }

    return {
      conversationId: conv.id,
      // Only the other party's DISPLAY NAME + message direction is exported —
      // never their profile, photos, email, or any post-match-gated field. The
      // export must not become a scrape vector for a match's data.
      withUser: otherName ?? 'Unknown',
      messages: messages.map((msg) => ({
        messageId: msg.id,
        from: msg.sender_id === userId ? 'me' : 'them',
        body: msg.deleted ? '[deleted]' : msg.body,
        timeGroup: coarseLabel(msg.sent_at),
        reactions: reactionMap[msg.id] ?? [],
      })),
    };
  });
}

// Derive a safe, human-meaningful file extension for a bundled photo from its
// storage_key (or url), defaulting to jpg. Never trusts the string beyond a tiny
// known-image allowlist.
function photoExt(row) {
  const src = row.storage_key || row.url || '';
  const m = /\.([a-zA-Z0-9]{1,5})(?:\?|#|$)/.exec(src);
  const ext = m ? m[1].toLowerCase() : 'jpg';
  return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
}

// ─── HTML rendering (self-contained, offline, escaped) ──────────────────────────

// Escape EVERY user-supplied string before it enters the HTML. This file is
// opened in a browser, so treat all stored data (name, bio, prompts, messages…)
// as untrusted — a self-contained export is a stored-XSS footgun otherwise.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Render a group of label/value rows, skipping any whose value is empty. Values
// are already-escaped HTML fragments (callers escape leaf strings via esc()).
function rows(pairs) {
  const body = pairs
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([label, v]) => `<div class="row"><dt>${esc(label)}</dt><dd>${v}</dd></div>`)
    .join('\n');
  return body ? `<dl class="grid">\n${body}\n</dl>` : '<p class="muted">Nothing recorded here.</p>';
}

const escList = (arr) => (Array.isArray(arr) && arr.length ? esc(arr.join(', ')) : '');
const yesNo = (v) => (v ? 'Yes' : 'No');

function renderProfileHtml(p) {
  const sections = [];

  sections.push(`<section aria-labelledby="p-basics"><h3 id="p-basics">Basics</h3>${rows([
    ['Display name', esc(p.displayName)],
    ['Tagline', esc(p.tagline)],
    ['Pronouns', esc(p.pronouns)],
    ['About me (bio)', esc(p.bio)],
    ['City', esc(p.distCity)],
    ['Date of birth', esc(p.dateOfBirth)],
    ['Age', p.age != null ? esc(p.age) : ''],
    ['Email', esc(p.email)],
  ])}</section>`);

  sections.push(`<section aria-labelledby="p-identity"><h3 id="p-identity">Identity</h3>${rows([
    ['Gender', esc(p.gender)],
    ['Gender (self-described)', esc(p.genderCustom)],
    ['Orientation', esc(p.orientation)],
  ])}</section>`);

  sections.push(`<section aria-labelledby="p-seeking"><h3 id="p-seeking">What I'm looking for</h3>${rows([
    ['Relationship goal', esc(p.relationshipGoal)],
    ['Relationship structure', esc(p.relationshipStructure)],
    ['Open to children', esc(p.wantsChildren)],
    ['Seeking', esc(p.seeking)],
    ['Preferred age range', p.prefAgeMin || p.prefAgeMax ? esc(`${p.prefAgeMin}–${p.prefAgeMax}`) : ''],
    ['Search radius (miles)', p.searchRadiusMiles ? esc(p.searchRadiusMiles) : ''],
  ])}</section>`);

  sections.push(`<section aria-labelledby="p-life"><h3 id="p-life">Lifestyle</h3>${rows([
    ['Smoking', esc(p.smoking)],
    ['Drinking', esc(p.drinking)],
  ])}</section>`);

  sections.push(`<section aria-labelledby="p-comm"><h3 id="p-comm">Communication &amp; sensory</h3>${rows([
    ['Communication note', esc(p.commNote)],
    ['Directness', esc(p.commDirectness)],
    ['Literal vs playful', esc(p.commLiteral)],
    ['Reply cadence', esc(p.commCadence)],
    ['Preferred environment', esc(p.sensoryEnvironment)],
    ['Preferred lighting', esc(p.sensoryLighting)],
    ['Social duration', esc(p.socialDuration)],
    ['Context card', esc(p.contextCard)],
  ])}</section>`);

  sections.push(`<section aria-labelledby="p-about"><h3 id="p-about">About me</h3>${rows([
    ['Occupation', esc(p.occupation)],
    ['Languages', esc(p.languages)],
    ['Helps me', escList(p.helpsMe)],
    ['Hard for me', escList(p.hardForMe)],
    ['Special interests', escList(p.specialInterests)],
    ['Interests', escList(p.interests)],
  ])}</section>`);

  const promptsHtml = Array.isArray(p.prompts) && p.prompts.length
    ? p.prompts.map((pr) => `<div class="prompt"><p class="prompt-q">${esc(pr.promptText)}</p><p class="prompt-a">${esc(pr.answer)}</p></div>`).join('\n')
    : '<p class="muted">No prompts answered.</p>';
  sections.push(`<section aria-labelledby="p-prompts"><h3 id="p-prompts">Prompts</h3>${promptsHtml}</section>`);

  sections.push(`<section aria-labelledby="p-account"><h3 id="p-account">Account</h3>${rows([
    ['Email verified', yesNo(p.emailVerified)],
    ['Identity verified', yesNo(p.verified)],
    ['Verification status', esc(p.verificationRequested)],
    ['Membership tier', esc(p.tier)],
    ['Profile paused', yesNo(p.paused)],
    ['Weekly digest', yesNo(p.weeklyDigest)],
    ['Notification style', esc(p.notificationTier)],
  ])}</section>`);

  return sections.join('\n');
}

function renderPhotosHtml(manifest) {
  const shown = manifest.filter((m) => m.file);
  if (!shown.length) {
    return '<p class="muted">No photos were included in this export.</p>';
  }
  return `<div class="gallery">${shown.map((m) => {
    const alt = m.description ? esc(m.description) : 'Profile photo';
    const cap = [m.isPrimary ? 'Primary' : '', m.description ? esc(m.description) : ''].filter(Boolean).join(' — ');
    return `<figure><img src="${esc(m.file)}" alt="${alt}" loading="lazy">${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
  }).join('\n')}</div>`;
}

function renderConversationsHtml(conversations) {
  if (!conversations.length) return '<p class="muted">No conversations yet.</p>';
  return conversations.map((conv) => {
    let lastGroup = null;
    const msgs = conv.messages.map((m) => {
      const sep = m.timeGroup !== lastGroup ? `<div class="daysep">${esc(m.timeGroup)}</div>` : '';
      lastGroup = m.timeGroup;
      const side = m.from === 'me' ? 'me' : 'them';
      const reactions = Array.isArray(m.reactions) && m.reactions.length
        ? `<span class="reactions">${esc(m.reactions.join(' '))}</span>`
        : '';
      return `${sep}<div class="msgrow ${side}"><div class="bubble">${esc(m.body)}${reactions}</div></div>`;
    }).join('\n');
    return `<section class="conversation" aria-label="Conversation with ${esc(conv.withUser)}"><h3>Conversation with ${esc(conv.withUser)}</h3>${msgs || '<p class="muted">No messages.</p>'}</section>`;
  }).join('\n');
}

function renderHtml({ exportedAt, profile, conversations, photoManifest }) {
  // One <style> block, system font stack, no external assets — opens offline in
  // any browser, reads calmly in the light OR dark of whatever opens it.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your Spectrum Dating data</title>
<style>
  :root {
    --bg: #f6f4ef; --panel: #ffffff; --ink: #2c2a28; --soft: #5c5852;
    --line: #e4ded4; --accent: #5B8A82; --me: #dcebe8; --them: #efece6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1c1f22; --panel: #24282c; --ink: #e7e4df; --soft: #a7a29a;
      --line: #343a3f; --accent: #7fb3aa; --me: #2b4a45; --them: #2c3136;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6; font-size: 17px;
  }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  header.top { margin-bottom: 28px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 21px; margin: 40px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--line); }
  h3 { font-size: 16px; margin: 22px 0 8px; color: var(--accent); }
  .muted { color: var(--soft); }
  section.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; margin-bottom: 16px; }
  dl.grid { margin: 0; }
  .row { display: grid; grid-template-columns: 200px 1fr; gap: 8px 18px; padding: 6px 0; border-top: 1px solid var(--line); }
  .row:first-child { border-top: 0; }
  dt { color: var(--soft); font-weight: 600; }
  dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
  @media (max-width: 520px) { .row { grid-template-columns: 1fr; gap: 2px; } }
  .prompt { padding: 8px 0; border-top: 1px solid var(--line); }
  .prompt:first-child { border-top: 0; }
  .prompt-q { color: var(--soft); margin: 0 0 2px; font-weight: 600; }
  .prompt-a { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .gallery { display: flex; flex-wrap: wrap; gap: 14px; }
  figure { margin: 0; width: 200px; }
  figure img { width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--line); display: block; }
  figcaption { color: var(--soft); font-size: 14px; margin-top: 6px; }
  .conversation { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; margin-bottom: 16px; }
  .daysep { text-align: center; color: var(--soft); font-size: 13px; margin: 14px 0 8px; }
  .msgrow { display: flex; margin: 4px 0; }
  .msgrow.me { justify-content: flex-end; }
  .msgrow.them { justify-content: flex-start; }
  .bubble { max-width: 78%; padding: 8px 12px; border-radius: 14px; background: var(--them); overflow-wrap: anywhere; white-space: pre-wrap; }
  .msgrow.me .bubble { background: var(--me); }
  .reactions { display: block; margin-top: 4px; font-size: 14px; }
  footer { margin-top: 40px; color: var(--soft); font-size: 14px; border-top: 1px solid var(--line); padding-top: 16px; }
</style>
</head>
<body>
<main>
  <header class="top">
    <h1>Your Spectrum Dating data</h1>
    <p class="muted">Exported ${esc(exportedAt)}</p>
  </header>

  <h2>Your profile</h2>
  <section class="card">
${renderProfileHtml(profile)}
  </section>

  <h2>Your photos</h2>
  <section class="card">
${renderPhotosHtml(photoManifest)}
  </section>

  <h2>Your conversations</h2>
${renderConversationsHtml(conversations)}

  <footer>
    <p>Times in this export are shown as gentle day-groups (&ldquo;Today&rdquo;,
    &ldquo;Yesterday&rdquo;, &ldquo;Mon&rdquo;, &ldquo;Jun 15&rdquo;) rather than exact
    clock times. This is on purpose &mdash; Spectrum Dating is calm by design and never
    records or shows precise timestamps.</p>
  </footer>
</main>
</body>
</html>`;
}

function renderReadme({ photoCount, missingPhotos, r2On }) {
  const lines = [];
  lines.push('Your Spectrum Dating data export');
  lines.push('================================');
  lines.push('');
  lines.push('This archive is a copy of your Spectrum Dating account data.');
  lines.push('');
  lines.push("What's inside:");
  lines.push('');
  lines.push('  index.html   Open this first. Double-click it to read your data in any');
  lines.push('               web browser. It works offline — no internet needed.');
  lines.push('  data.json    The same data in a machine-readable format, in case you');
  lines.push('               ever want to move it to another service.');
  lines.push(`  photos/      Your profile photos (${photoCount} included).`);
  lines.push('  README.txt   This file.');
  lines.push('');
  lines.push('A note on times:');
  lines.push('');
  lines.push('  Times are shown as gentle day-groups ("Today", "Yesterday", "Mon",');
  lines.push('  "Jun 15") rather than exact clock times. This is on purpose — Spectrum');
  lines.push('  Dating is designed to feel calm and never records or shows precise');
  lines.push('  timestamps.');
  lines.push('');
  lines.push('A note on privacy:');
  lines.push('');
  lines.push('  This is YOUR data. For your conversations we include your own messages');
  lines.push('  in full, but we only show the other person by name and message');
  lines.push('  direction — never their profile, photos, or contact details.');
  if (missingPhotos.length) {
    lines.push('');
    lines.push(`Note: ${missingPhotos.length} photo(s) could not be included in this`);
    lines.push(r2On
      ? '  archive (they could not be retrieved from storage). Everything else is complete.'
      : '  archive because photo storage was unavailable at export time. Everything else is complete.');
  }
  lines.push('');
  lines.push('If you have any questions about your data, please contact support.');
  lines.push('');
  return lines.join('\n');
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /export/archive — stream a ZIP: index.html (readable) + data.json
// (machine-readable, carries the GDPR Art. 20 requirement) + photos/ + README.txt.
// This is a FREE feature (GDPR right) and is never gated by tier.
router.get('/archive', exportLimiter, async (req, res) => {
  const userId = resolveExportUser(req, res);
  if (!userId) return; // 401 already sent

  // The export URL is sensitive (carries a bearer token in the query string).
  // Keep it out of any proxy/CDN cache and strip the Referer.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const { db } = req.ctx;

  const profile = assembleOwnProfile(db, userId);
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  // Add the requester's own email (an account fact not in the shared profile shape).
  profile.email = db.prepare('SELECT email FROM users WHERE id = ?').get(userId)?.email || '';

  const conversations = buildConversations(db, userId);

  // Photo rows INCLUDING storage_key (listPhotos deliberately hides it). Owner's
  // FULL gallery, including pending/rejected — it's their own data; the review
  // gate only governs what OTHERS see. Only ever the requester's own photos.
  const photoRows = db.prepare(
    'SELECT id, storage_key, url, description, is_primary, position, review_status FROM profile_photos WHERE user_id = ? ORDER BY position ASC, created_at ASC'
  ).all(userId);

  const r2On = r2Configured();
  const photoManifest = [];
  const photoBuffers = [];
  const missingPhotos = [];
  let idx = 0;
  for (const row of photoRows) {
    idx += 1;
    const name = `photos/profile-${String(idx).padStart(2, '0')}.${photoExt(row)}`;
    const entry = {
      file: null,
      description: row.description || '',
      isPrimary: !!row.is_primary,
      position: row.position,
      reviewStatus: row.review_status,
    };
    let ok = false;
    // If R2 isn't configured, we still produce the ZIP — just without photo bytes.
    if (r2On && row.storage_key) {
      try {
        const buf = await getObjectBytes(row.storage_key);
        photoBuffers.push({ name, buf });
        entry.file = name;
        ok = true;
      } catch (err) {
        // Best-effort: a single unreadable object skips that photo and is noted —
        // it never fails the whole export.
        console.warn(`[export] photo fetch failed for ${row.id}: ${err.message}`);
      }
    }
    if (!ok) {
      missingPhotos.push({
        description: row.description || '',
        reason: r2On ? (row.storage_key ? 'could not be retrieved' : 'no stored file') : 'photo storage unavailable',
      });
    }
    photoManifest.push(entry);
  }
  // The manifest (with bundled file paths) IS the exported photo record.
  profile.photos = photoManifest;

  const exportedAt = coarseLabel(Date.now());
  const data = {
    // Coarsened per the no-raw-time product rule. The requester's OWN data is at
    // full fidelity; the other party in each conversation stays minimized.
    exportedAt,
    userId,
    profile,
    conversations,
    photos: { included: photoBuffers.length, notIncluded: missingPhotos, storageAvailable: r2On },
  };

  const html = renderHtml({ exportedAt, profile, conversations, photoManifest });
  const readme = renderReadme({ photoCount: photoBuffers.length, missingPhotos, r2On });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="spectrum-dating-export.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', (err) => console.warn('[export] archive warning', err));
  archive.on('error', (err) => {
    console.error('[export] archive error', err);
    // Once streaming has begun the status code is locked — destroy the socket so
    // the client never mistakes a truncated body for a complete ZIP.
    if (res.headersSent) res.destroy(err);
    else res.status(500).json({ error: 'Export failed. Please try again.' });
  });
  archive.pipe(res);
  archive.append(html, { name: 'index.html' });
  archive.append(JSON.stringify(data, null, 2), { name: 'data.json' });
  archive.append(readme, { name: 'README.txt' });
  for (const p of photoBuffers) archive.append(p.buf, { name: p.name });
  archive.finalize();
});

// GET /export/conversations — LEGACY JSON export (conversations only). Kept for
// backward compatibility with any old download link; the ZIP archive above is
// the complete, GDPR-Art.20 export the app now links to.
router.get('/conversations', exportLimiter, (req, res) => {
  const userId = resolveExportUser(req, res);
  if (!userId) return;

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const { db } = req.ctx;
  const exportData = {
    exportedAt: coarseLabel(Date.now()),
    userId,
    conversations: buildConversations(db, userId),
  };

  res.setHeader('Content-Disposition', 'attachment; filename="spectrum-export.json"');
  res.setHeader('Content-Type', 'application/json');
  res.json(exportData);
});

export default router;
