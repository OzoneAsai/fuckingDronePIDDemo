import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';

const FRAME_URL = 'https://raw.githubusercontent.com/WE-are-FPV/JeNo-3-3.5/518b3f75ae36243f16709af16b5cfcd1805c885f/01-FRAME/JeNo3_ALL_VERSIONS_1.2.1.stl';
const FRAME_RELATIVE_PATH = path.join('models', '01-FRAME', 'JeNo3_ALL_VERSIONS_1.2.1.stl');
const FORCE_REFRESH = process.env.FORCE_REFRESH_JENO_FRAME === 'true';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const frameDir = path.join(publicDir, path.dirname(FRAME_RELATIVE_PATH));
const framePath = path.join(publicDir, FRAME_RELATIVE_PATH);

async function fileExistsNonEmpty(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.size > 0;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function ensureDirectories() {
  await mkdir(frameDir, { recursive: true });
}

async function downloadViaFetch(tempPath) {
  const response = await fetch(FRAME_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download STL asset: ${response.status} ${response.statusText}`);
  }

  const writeStream = createWriteStream(tempPath);
  const body = Readable.fromWeb(response.body);
  await pipeline(body, writeStream);
}

async function downloadViaCurl(tempPath) {
  await new Promise((resolve, reject) => {
    const args = ['-L', FRAME_URL, '--fail', '--silent', '--show-error', '-o', tempPath];
    const curl = spawn('curl', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    curl.on('error', reject);
    curl.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`curl exited with code ${code}`));
      }
    });
  });
}

async function downloadFrame() {
  console.log(`[frame] Downloading JeNo3 STL asset from ${FRAME_URL}`);
  await ensureDirectories();

  const tempPath = `${framePath}.download`;

  try {
    await downloadViaFetch(tempPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    const cause = error?.cause ?? error;
    console.warn(`[frame] Node fetch failed (${cause?.code ?? error.message}); falling back to curl`);
    await downloadViaCurl(tempPath);
  }

  await access(tempPath);
  await mkdir(path.dirname(framePath), { recursive: true });
  await stat(tempPath);
  if (await fileExistsNonEmpty(framePath)) {
    await rm(framePath);
  }
  await rename(tempPath, framePath);
  console.log(`[frame] Saved JeNo3 STL to ${framePath}`);
}

let ensurePromise;

export async function ensureFrameModel({ silent = false } = {}) {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      try {
        const exists = await fileExistsNonEmpty(framePath);
        if (exists && !FORCE_REFRESH) {
          if (!silent) {
            console.log(`[frame] Using cached JeNo3 STL at ${framePath}`);
          }
          return framePath;
        }

        await downloadFrame();
        return framePath;
      } catch (error) {
        ensurePromise = undefined;
        throw error;
      }
    })();
  } else if (!silent && !FORCE_REFRESH) {
    console.log(`[frame] Using cached JeNo3 STL at ${framePath}`);
  }

  const result = await ensurePromise;

  if (FORCE_REFRESH) {
    ensurePromise = undefined;
  }

  return result;
}

export function getFramePath() {
  return framePath;
}
