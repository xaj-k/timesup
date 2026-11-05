/*
 * Times Up as an installed app. When the page comes from a web server (not
 * opened as a file), this registers sw.js so the app works offline, and
 * shows an "Install app" button where the browser can install it.
 */
(function () {
  'use strict';

  const served = location.protocol === 'https:' || location.protocol === 'http:';
  if (!served || window.self !== window.top || !('serviceWorker' in navigator)) return;

  const installButton = document.getElementById('install');
  const installHelp = document.getElementById('install-help');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // ---------- the offline copy, and updates to it ----------

  const hadWorker = Boolean(navigator.serviceWorker.controller);
  let updated = false;
  navigator.serviceWorker.register('sw.js').then(
    (registration) => {
      // Look for a newer version whenever the app comes back to the front.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    },
    () => {
      // No offline copy; the app still works while online.
    }
  );
  // A new version has taken over. Switch to it when the app next comes back to
  // the front on the setup screen, so a round is never cut short.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadWorker) updated = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (updated && document.visibilityState === 'visible' && !document.getElementById('setup').hidden) location.reload();
  });

  // An installed app asks to keep its saved history even when the device is short on space.
  if (standalone && navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((kept) => kept || navigator.storage.persist()).catch(() => {});
  }

  // ---------- the "Install app" button ----------

  let offer = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    offer = event;
    installButton.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    installButton.hidden = true;
    installHelp.hidden = true;
  });

  // iPhone and iPad install from the Share menu, so the button explains where that is.
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (apple && !standalone) {
    installButton.hidden = false;
    installButton.setAttribute('aria-expanded', 'false');
    installButton.setAttribute('aria-controls', 'install-help');
  }

  installButton.addEventListener('click', () => {
    if (offer) {
      const prompt = offer;
      offer = null;
      installButton.hidden = true;
      prompt.prompt();
      return;
    }
    const open = installHelp.hidden;
    installHelp.hidden = !open;
    installButton.setAttribute('aria-expanded', String(open));
  });
})();
