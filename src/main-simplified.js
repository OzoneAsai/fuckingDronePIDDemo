import SimplifiedApp from './SimplifiedApp.svelte';

const target =
  document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));

const app = new SimplifiedApp({ target });

export default app;
