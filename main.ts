// SOLANO HEAT — an original open-world crime game set in the coastal city of
// Port Solano, built for the make.fun gta6-01 bounty. This program is the
// entry's hand-in step.
//
// The game itself is this directory's game/ folder: plain static files a
// desktop browser loads fully offline (game/index.html and its ES modules,
// Three.js vendored under game/vendor/, no network requests). This program
// copies game/ and screenshots/ into the output directory and writes
// dossier.json beside them — the summary the judge reads — using the vendored
// dossier builder in vendor/makefun-game.ts.
//
// Run the game locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps: the text budget shapes how much source the dossier
// shows; the rest refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files or 48 MiB under game/;
// a path under game/ over 1000 bytes).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
