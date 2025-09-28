import App from './App.svelte';

const target =
  document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));

const app = App.mount(target);

export default app;
