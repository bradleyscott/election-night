import { useEffect, useState, useCallback } from 'react';
import { type RegisterSWOptions } from 'vite-plugin-pwa/types';

type PwaUpdateStatus = 'loading' | 'update-available' | 'updated' | 'offline-ready' | 'unsupported';

export default function PwaUpdatePrompt() {
  const [status, setStatus] = useState<PwaUpdateStatus>('loading');
  const [showPrompt, setShowPrompt] = useState(false);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  const updateServiceWorker = useCallback(
    (reloadPage?: boolean) => {
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
          if (registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        });
        if (reloadPage) {
          window.location.reload();
        }
      }
    },
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      setStatus('unsupported');
      return;
    }

    let swRegistration: ServiceWorkerRegistration | null = null;

    const handleSWUpdate = (reg: ServiceWorkerRegistration) => {
      swRegistration = reg;
      if (reg.waiting) {
        // A new version is waiting to activate
        setNeedRefresh(true);
        setStatus('update-available');
        setShowPrompt(true);
      }
    };

    // Listen for the custom event emitted by vite-plugin-pwa
    const handleVitePwaUpdate = (e: CustomEvent) => {
      const { registration } = e.detail;
      handleSWUpdate(registration);
    };

    // Listen for offline ready event
    const handleVitePwaOfflineReady = () => {
      setOfflineReady(true);
      setStatus('offline-ready');
    };

    window.addEventListener('vite:pwa:update' as any, handleVitePwaUpdate as any);
    window.addEventListener('vite:pwa:offline-ready' as any, handleVitePwaOfflineReady as any);

    // Also check for existing waiting worker
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.waiting) {
        handleSWUpdate(registration);
      }

      // Listen for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              handleSWUpdate(registration);
            }
          });
        }
      });
    });

    return () => {
      window.removeEventListener('vite:pwa:update' as any, handleVitePwaUpdate as any);
      window.removeEventListener('vite:pwa:offline-ready' as any, handleVitePwaOfflineReady as any);
    };
  }, []);

  const handleRefresh = useCallback(() => {
    updateServiceWorker(true);
    setShowPrompt(false);
  }, [updateServiceWorker]);

  const handleDismiss = useCallback(() => {
    setShowPrompt(false);
  }, []);

  if (!showPrompt) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-2 fade-in rounded-lg border border-stone-700 bg-stone-900/95 p-4 shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-stone-100">
            {needRefresh
              ? 'A new version is available!'
              : 'App ready for offline use'}
          </p>
          <p className="mt-1 text-xs text-stone-400">
            {needRefresh
              ? 'Update to get the latest results and features.'
              : 'The app is now cached and can work offline.'}
          </p>
        </div>
      </div>
      {needRefresh && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleRefresh}
            className="inline-flex items-center justify-center rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
          >
            Update
          </button>
          <button
            onClick={handleDismiss}
            className="inline-flex items-center justify-center rounded-md border border-stone-600 px-3 py-1.5 text-xs font-medium text-stone-300 hover:bg-stone-800 transition-colors"
          >
            Later
          </button>
        </div>
      )}
      {offlineReady && !needRefresh && (
        <div className="mt-3">
          <button
            onClick={handleDismiss}
            className="inline-flex items-center justify-center rounded-md bg-stone-700 px-3 py-1.5 text-xs font-medium text-stone-200 hover:bg-stone-600 transition-colors"
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
