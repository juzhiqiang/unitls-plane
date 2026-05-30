'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void> | void;
};

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      );
    };
  }, []);

  if (!isVisible || !deferredPrompt) {
    return null;
  }

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    setDeferredPrompt(null);
    setIsVisible(false);
  };

  const handleDismiss = () => {
    setDeferredPrompt(null);
    setIsVisible(false);
  };

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 border border-border bg-card p-4 text-left text-card-foreground shadow-none sm:left-auto sm:w-[22rem]">
      <div className="flex items-start gap-3">
        <Download className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Install Utils-Plane</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            Add it to your desktop for faster access and offline fallback.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleInstall}>
              <Download aria-hidden="true" />
              Install
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDismiss}>
              <X aria-hidden="true" />
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
