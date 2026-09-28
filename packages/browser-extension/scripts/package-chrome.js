// Chrome zip: strip MV2-only `background.scripts` (Chrome warns on it).
// Source manifest.json keeps the key — Firefox needs it, AMO signs source.
// ponytail: temp staging dir, not a second manifest to keep in sync.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stage = mkdtempSync(join(tmpdir(), 'dc-chrome-'));
for (const f of ['popup.html', 'popup.css', 'fullpage.html', 'fullpage.css', 'shared.css', 'dist', 'icons']) {
  cpSync(join(root, f), join(stage, f), { recursive: true });
}
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
delete manifest.background.scripts;
writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
execSync(
  `rm -f ${root}/datacloak-extension-*.zip && cd ${stage} && zip -qr ${root}/datacloak-extension-${version}.zip manifest.json popup.html popup.css fullpage.html fullpage.css shared.css dist icons`,
  { stdio: 'inherit' },
);
rmSync(stage, { recursive: true });
