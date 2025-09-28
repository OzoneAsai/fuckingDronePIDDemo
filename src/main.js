import App from './App.svelte';

const target =
  document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));

const app = new App({ target });

export default app;
