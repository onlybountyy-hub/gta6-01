// SOLANO HEAT — hand-in program for the make.fun gta6-01 bounty.
//
// What this file does, in plain terms:
//   1. Work out where the entry lives (the folder beside this file) and
//      where the grader wants the output (MAKEFUN_OUTPUT_DIR, or /output
//      when the variable is absent).
//   2. Mirror the playable game/ tree and the screenshots/ tree into the
//      output folder so the grader sees exactly what a player would get.
//   3. Ask the vendored dossier library to summarise that output into
//      dossier.json, using the caps the competition scorer enforces.
//
// Only the Node.js standard library is used, so the file runs on a bare
// Node 22 install with nothing to download first.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// --- locating things -------------------------------------------------------

const entryRoot = fileURLToPath(new URL('.', import.meta.url));
const outputRoot = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function describeTarget(label: string, folder: string): void {
  // A tiny bit of logging so a human running this by hand can see what
  // happened without digging through the output folder afterwards.
  if (!existsSync(folder)) {
    console.log(`[solano] ${label}: nothing at ${folder} yet`);
    return;
  }
  const names = readdirSync(folder);
  console.log(`[solano] ${label}: ${names.length} top-level item(s) in ${folder}`);
}

// --- sanity checks on the screenshots --------------------------------------
// The scorer refuses an entry with more than four screenshots or with any
// single screenshot over 256 KiB. Catching that here, with a clear message,
// is friendlier than discovering it from a rejected grade later.

function checkScreenshotCaps(folder: string): void {
  if (!existsSync(folder)) return;
  const shots = readdirSync(folder).filter((name) => !name.startsWith('.'));
  if (shots.length > 4) {
    throw new Error(`screenshots/ holds ${shots.length} files; the cap is 4`);
  }
  for (const name of shots) {
    const size = statSync(join(folder, name)).size;
    if (size > 262144) {
      throw new Error(`screenshot ${name} is ${size} bytes; the cap is 262144`);
    }
  }
}

// --- the copy step ----------------------------------------------------------

mkdirSync(outputRoot, { recursive: true });

// Fail loudly and early if the entry tree is incomplete: a missing game/
// folder would otherwise surface as a confusing copy error halfway through
// the hand-in, long after the real mistake was made.
for (const required of ['game', 'screenshots', 'vendor']) {
  if (!existsSync(join(entryRoot, required))) {
    throw new Error(`entry is incomplete: ${required}/ is missing beside main.ts`);
  }
}

const gameSource = join(entryRoot, 'game');
const gameTarget = join(outputRoot, 'game');
cpSync(gameSource, gameTarget, { recursive: true });
describeTarget('game copied', gameTarget);

const shotsSource = join(entryRoot, 'screenshots');
const shotsTarget = join(outputRoot, 'screenshots');
mkdirSync(shotsTarget, { recursive: true });
checkScreenshotCaps(shotsSource);
if (existsSync(shotsSource)) {
  cpSync(shotsSource, shotsTarget, { recursive: true });
}
describeTarget('screenshots copied', shotsTarget);

// --- the dossier -------------------------------------------------------------
// These numbers are the scorer's caps for this bounty. text_max_bytes is the
// only one that changes the bytes produced; the rest make buildDossier refuse
// an entry the scorer would refuse anyway, which is exactly what we want
// during local testing.

const dossierText = buildDossier(outputRoot, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});

writeFileSync(join(outputRoot, 'dossier.json'), dossierText);
console.log(`[solano] dossier.json written (${dossierText.length} chars) to ${outputRoot}`);
