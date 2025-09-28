import App from './App.svelte';

const app = new App({
  target: document.getElementById('app') ?? document.body.appendChild(document.createElement('div')),
});

export default app;
