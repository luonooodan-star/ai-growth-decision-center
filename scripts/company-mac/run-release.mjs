import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readRelease,
  releaseDirectory,
  verifyRelease,
} from './release-paths.mjs';
const root = process.cwd();
const release = readRelease(root);
const directory = release ? releaseDirectory(root, release.id) : root;
if (release) verifyRelease(directory);
// Keep cwd/runtime/credentials/SQLite at the original repository.
process.env.GROWTH_RELEASE_ID = release?.id || 'legacy';
process.env.GROWTH_CLIENT_DIRECTORY = join(directory, 'dist/client');
// Same process: launchctl stops the actual server, with no orphan child listener.
await import(pathToFileURL(join(directory, 'dist/server/standalone.js')).href);
