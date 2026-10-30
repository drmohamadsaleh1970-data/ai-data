// "build": syntax-checks every server/public module (no bundling step needed).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const files = [...fs.readdirSync('api').map((f) => `api/${f}`), ...fs.readdirSync('server').map((f) => `server/${f}`), ...fs.readdirSync('public').filter((f) => f.endsWith('.js')).map((f) => `public/${f}`)];
for (const f of files.filter((f) => f.endsWith('.js'))) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`Checked ${files.length} files.`);
