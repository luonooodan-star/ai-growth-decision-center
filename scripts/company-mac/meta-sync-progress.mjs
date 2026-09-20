#!/usr/bin/env node
// Non-secret continuation state only; never stores tokens or ad contents.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../../.runtime/', import.meta.url));
const path = `${directory}meta-sync-progress.json`;
const command = process.argv[2] || 'get';
if (command === 'get') {
  try { process.stdout.write(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; process.stdout.write('{"offset":0}'); }
} else if (command === 'save') {
  const offset = Number(process.argv[3]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 99999999) throw new Error('offset 无效');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(`${path}.tmp`, JSON.stringify({ offset, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
} else throw new Error('用法：meta-sync-progress.mjs get | save <offset>');
