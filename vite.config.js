import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { ensureFrameModel } from './scripts/ensureFrameModel.js';

export default defineConfig(async () => {
  await ensureFrameModel({ silent: true });

  return {
    plugins: [svelte()],
    worker: {
      format: 'es'
    }
  };
});
