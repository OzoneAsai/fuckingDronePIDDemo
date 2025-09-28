#!/usr/bin/env node
import { ensureFrameModel } from './ensureFrameModel.js';

async function main() {
  try {
    await ensureFrameModel({ silent: true });
    console.log('[check] STL asset ready.');
  } catch (error) {
    console.error('[check] Failed:', error);
    process.exitCode = 1;
  }
}

await main();
