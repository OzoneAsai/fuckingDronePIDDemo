import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  preprocess: [vitePreprocess()],
  compilerOptions: {
    compatibility: {
      componentApi: 4,
    },
  },
};

export default config;
