/**
 * Production: minify public CSS/JS into *.min.* alongside sources.
 * Run: npm install && npm run minify
 * Deploy minified files + point HTML to .min (or swap names in CI).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

const files = [
  ['css/osa-design.css', 'css/osa-design.min.css'],
  ['css/osa-ai.css', 'css/osa-ai.min.css'],
  ['assets/js/portal-shell.js', 'assets/js/portal-shell.min.js'],
  ['assets/js/osa-chat-widget.js', 'assets/js/osa-chat-widget.min.js'],
  ['assets/js/osa-chat-loader.js', 'assets/js/osa-chat-loader.min.js'],
];

for (const [relIn, relOut] of files) {
  const input = join(publicDir, relIn);
  const output = join(publicDir, relOut);
  const ext = relIn.endsWith('.css') ? 'css' : 'js';
  const code = await readFile(input, 'utf8');
  const result = await esbuild.transform(code, {
    loader: ext,
    minify: true,
    legalComments: 'none',
  });
  await writeFile(output, result.code);
}
