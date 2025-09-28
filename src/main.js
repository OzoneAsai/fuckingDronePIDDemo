import App from './App.svelte';

const target =
  document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));

console.log('[main] Mounting App', { hasExistingMountPoint: !!document.getElementById('app') });

const app = new App({ target });

export default app;
