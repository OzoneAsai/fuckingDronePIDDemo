import App from './App.svelte';

const target =
  document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));

console.log('[main] Mounting App', { hasExistingMountPoint: !!document.getElementById('app') });

const app = new App({ target });

registerServiceWorker();

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[sw] Service workers are not supported in this browser');
    return;
  }

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      console.log('[sw] Registered service worker', registration);

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) {
          return;
        }

        console.log('[sw] Update found');
        installing.addEventListener('statechange', () => {
          console.log('[sw] Installing worker state', installing.state);
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[sw] New content available');
          }
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[sw] Controller changed');
      });
    } catch (error) {
      console.error('[sw] Failed to register service worker', error);
    }
  };

  if (document.readyState === 'complete') {
    void register();
  } else {
    window.addEventListener('load', () => void register(), { once: true });
  }
}

export default app;
