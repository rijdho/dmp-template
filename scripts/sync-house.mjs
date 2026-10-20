// Copy the house style (house.css + fonts) from a sibling house-style checkout into house/,
// and record what was copied in house/house.lock.json. Never edit the copy: this project's own styles
// go in style.css, which index.html loads after it. tests/house.test.mjs enforces both.
//   node scripts/sync-house.mjs            (or HOUSE_STYLE=/path/to/house-style node scripts/sync-house.mjs)
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const origin = resolve(process.env.HOUSE_STYLE || resolve(here, '../../house-style'));
const dest = resolve(here, '../house');
if (!existsSync(resolve(origin, 'house.css'))) {
  console.error(`house-style not found at ${origin} (set HOUSE_STYLE to its checkout)`);
  process.exit(1);
}
mkdirSync(resolve(dest, 'fonts'), { recursive: true });
copyFileSync(resolve(origin, 'house.css'), resolve(dest, 'house.css'));
for (const f of readdirSync(resolve(origin, 'fonts'))) copyFileSync(resolve(origin, 'fonts', f), resolve(dest, 'fonts', f));
const css = readFileSync(resolve(dest, 'house.css'));
const version = /house-style (\d+\.\d+\.\d+)/.exec(css.toString())?.[1] ?? 'unknown';
const sha256 = createHash('sha256').update(css).digest('hex');
writeFileSync(resolve(dest, 'house.lock.json'), JSON.stringify({ version, sha256 }, null, 2) + '\n');
console.log(`house-style ${version} synced (${sha256.slice(0, 12)})`);
