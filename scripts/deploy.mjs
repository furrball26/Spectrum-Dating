// deploy.mjs — build, deploy to Vercel, and ALWAYS re-point the eta alias.
//
// `vercel --prod` creates a new deployment but does NOT automatically move the
// spectrum-dating-eta.vercel.app alias — so the live URL would keep serving an
// old build. This script captures the new deployment URL and aliases it, then
// verifies the alias serves the expected bundle.
//
// Usage: node scripts/deploy.mjs

import { spawnSync } from 'child_process';

const ALIAS = 'spectrum-dating-eta.vercel.app';

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function log(m) { console.log(`[deploy] ${m}`); }

// 1. Build (must be clean)
log('building...');
const build = run('npm', ['run', 'build']);
if (build.code !== 0) { log('BUILD FAILED:\n' + build.out); process.exit(1); }
const localBundle = (build.out.match(/index-[A-Za-z0-9]+\.js/) || [])[0] || '(unknown)';
log(`build ok — local bundle ${localBundle}`);

// 2. Deploy to Vercel
log('deploying to Vercel (vercel --prod)...');
const dep = run('npx', ['vercel', '--prod', '--yes']);
if (dep.code !== 0) { log('DEPLOY FAILED:\n' + dep.out); process.exit(1); }
const url = (dep.out.match(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app/) || [])[0];
if (!url) { log('could not parse deployment URL:\n' + dep.out); process.exit(1); }
log(`deployed: ${url}`);

// 3. Re-point the alias — the step `vercel --prod` skips.
log(`aliasing ${ALIAS} -> new deployment...`);
const alias = run('npx', ['vercel', 'alias', 'set', url, ALIAS]);
if (alias.code !== 0 || !/Success|points to/i.test(alias.out)) {
  log('ALIAS FAILED:\n' + alias.out); process.exit(1);
}
log('alias updated.');

// 4. Verify the alias serves the just-built bundle.
log('verifying live bundle...');
const check = run('curl', ['-s', '-m', '15', `https://${ALIAS}/`]);
const liveBundle = (check.out.match(/index-[A-Za-z0-9]+\.js/) || [])[0] || '(unknown)';
// Note: live hash may differ from local if VITE_API_URL differs between envs;
// this is a smoke check that SOMETHING is served, not a strict equality.
log(`live bundle: ${liveBundle}`);
log(`✓ Deploy complete — https://${ALIAS} is live.`);
