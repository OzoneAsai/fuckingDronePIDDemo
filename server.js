#!/usr/bin/env node
import { createServer } from 'vite';
import { ensureFrameModel } from './scripts/ensureFrameModel.js';

async function main() {
  const port = Number.parseInt(process.env.PORT ?? '5173', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  await ensureFrameModel();

  const vite = await createServer({
    server: {
      host,
      port,
      strictPort: true
    }
  });

  await vite.listen();
  vite.printUrls();
  console.log(`\nVite dev server running on http://${host}:${port}`);

  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await vite.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Failed to start Vite dev server:', error);
  process.exit(1);
});
