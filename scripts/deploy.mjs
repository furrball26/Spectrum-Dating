// deploy.mjs — deploy to Railway, then BLOCK until /health returns 200.
// Exits non-zero (loudly) if the service does not come up, so a broken
// deploy can never again pass silently behind a --detach.
//
// Usage: node scripts/deploy.mjs
//   HEALTH_URL  override health endpoint (default: production)
//   TIMEOUT_S   max seconds to wait for health (default: 240)

import { spawnSync } from 'child_process';

const HEALTH_URL =
  process.env.HEALTH_URL ||
  'https://spectrum-dating-server-production.up.railway.app/health';
const TIMEOUT_S = parseInt(process.env.TIMEOUT_S) || 240;
const POLL_S = 10;

function log(msg) {
  console.log(`[deploy] ${msg}`);
}

async function checkHealth() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.status !== 200) return false;
    const body = await res.json().catch(() => ({}));
    return body.status === 'ok';
  } catch {
    return false;
  }
}

async function sleep(s) {
  return new Promise((r) => setTimeout(r, s * 1000));
}

async function main() {
  log('uploading to Railway (railway up --detach)...');
  const up = spawnSync('railway', ['up', '--detach'], {
    stdio: 'inherit',
    shell: true,
  });
  if (up.status !== 0) {
    log('ERROR: railway up failed to upload. Aborting.');
    process.exit(1);
  }

  log(`upload done. Polling ${HEALTH_URL} for up to ${TIMEOUT_S}s...`);
  const deadline = Date.now() + TIMEOUT_S * 1000;
  let attempt = 0;

  // Give the builder a head start before the first poll.
  await sleep(POLL_S);

  while (Date.now() < deadline) {
    attempt++;
    if (await checkHealth()) {
      log(`✓ HEALTHY after ${attempt} check(s). Deploy verified.`);
      process.exit(0);
    }
    log(`check ${attempt}: not healthy yet...`);
    await sleep(POLL_S);
  }

  log('');
  log(`✗ FAILED: service did not return healthy within ${TIMEOUT_S}s.`);
  log('  The deploy may have crashed at startup. Check:');
  log('    railway logs --deployment');
  log('  Do NOT assume the deploy succeeded.');
  process.exit(1);
}

main().catch((e) => {
  log(`ERROR: ${e.message}`);
  process.exit(1);
});
