// deploy.mjs — deploy to Railway, then BLOCK until /health returns 200.
// Exits non-zero (loudly) if the service does not come up, so a broken
// deploy can never again pass silently behind a --detach.
//
// Usage: node scripts/deploy.mjs
//   HEALTH_URL  override health endpoint (default: production)
//   TIMEOUT_S   max seconds to wait for health (default: 240)

import { spawnSync } from 'child_process';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const BUILD_INFO_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'build-info.json');

const HEALTH_URL =
  process.env.HEALTH_URL ||
  'https://spectrum-dating-server-production.up.railway.app/health';
const TIMEOUT_S = parseInt(process.env.TIMEOUT_S) || 240;
const POLL_S = 10;

function log(msg) {
  console.log(`[deploy] ${msg}`);
}

// The commit we're deploying. The guard waits until /health reports THIS sha,
// so it can't be fooled by the old replica still answering during rollover.
function localSha() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Returns: 'match' (new build live), 'stale' (healthy but old build),
// 'down' (no healthy response).
async function checkHealth(wantSha) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.status !== 200) return 'down';
    const body = await res.json().catch(() => ({}));
    if (body.status !== 'ok') return 'down';
    // If we can't determine the deployed sha on either side, fall back to a
    // plain health check (don't block deploys when sha is unavailable).
    if (!wantSha || !body.sha) return 'match';
    return body.sha === wantSha ? 'match' : 'stale';
  } catch {
    return 'down';
  }
}

async function sleep(s) {
  return new Promise((r) => setTimeout(r, s * 1000));
}

async function main() {
  const wantSha = localSha();
  log(wantSha ? `deploying commit ${wantSha.slice(0, 8)}` : 'deploying (git sha unavailable)');

  // Stamp the SHA into a file that railway up uploads, so the running build can
  // report it on /health. (Railway doesn't inject git metadata for CLI deploys.)
  if (wantSha) {
    writeFileSync(BUILD_INFO_PATH, JSON.stringify({ sha: wantSha }) + '\n');
    log('stamped src/build-info.json');
  }

  log('uploading to Railway (railway up --detach)...');
  const up = spawnSync('railway', ['up', '--detach'], {
    stdio: 'inherit',
    shell: true,
  });
  // Restore the placeholder so the working tree stays clean — the uploaded
  // snapshot already captured the real SHA.
  if (wantSha) {
    try { writeFileSync(BUILD_INFO_PATH, JSON.stringify({ sha: null }) + '\n'); } catch {}
  }

  if (up.status !== 0) {
    log('ERROR: railway up failed to upload. Aborting.');
    process.exit(1);
  }

  log(`upload done. Polling ${HEALTH_URL} for the NEW build (up to ${TIMEOUT_S}s)...`);
  const deadline = Date.now() + TIMEOUT_S * 1000;
  let attempt = 0;
  let sawStale = false;

  // Give the builder a head start before the first poll.
  await sleep(POLL_S);

  while (Date.now() < deadline) {
    attempt++;
    const state = await checkHealth(wantSha);
    if (state === 'match') {
      log(`✓ HEALTHY — new build is live and verified after ${attempt} check(s).`);
      process.exit(0);
    }
    if (state === 'stale') {
      sawStale = true;
      log(`check ${attempt}: old build still serving (rollover in progress)...`);
    } else {
      log(`check ${attempt}: not healthy yet...`);
    }
    await sleep(POLL_S);
  }

  log('');
  if (sawStale) {
    log(`✗ FAILED: old build kept serving for ${TIMEOUT_S}s — the new build never`);
    log('  became healthy. It likely crashed at startup while the old replica held on.');
  } else {
    log(`✗ FAILED: service did not return healthy within ${TIMEOUT_S}s.`);
  }
  log('  Check:  railway logs --deployment');
  log('  Do NOT assume the deploy succeeded.');
  process.exit(1);
}

main().catch((e) => {
  log(`ERROR: ${e.message}`);
  process.exit(1);
});
