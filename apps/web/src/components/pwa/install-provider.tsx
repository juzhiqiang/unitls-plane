'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type InstallOutcome = 'accepted' | 'dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: InstallOutcome;
    platform: string;
  }>;
}

interface InstallAppContextValue {
  canInstall: boolean;
  install: () => Promise<InstallOutcome | null>;
}

const InstallAppContext = createContext<InstallAppContextValue | null>(null);

export function InstallProvider({ children }: { children: ReactNode }) {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const installEventRef = useRef<BeforeInstallPromptEvent | null>(null);
  const installInFlightRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      const nextInstallEvent = event as BeforeInstallPromptEvent;
      installEventRef.current = nextInstallEvent;
      setInstallEvent(nextInstallEvent);
    };
    const handleAppInstalled = () => {
      installEventRef.current = null;
      setInstallEvent(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
      installEventRef.current = null;
      installInFlightRef.current = null;
    };
  }, []);

  const install = useCallback(async (): Promise<InstallOutcome | null> => {
    const event = installEventRef.current;
    if (!event || installInFlightRef.current) {
      return null;
    }

    installInFlightRef.current = event;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      return choice.outcome;
    } finally {
      if (installEventRef.current === event) {
        installEventRef.current = null;
        setInstallEvent(current => (current === event ? null : current));
      }
      if (installInFlightRef.current === event) {
        installInFlightRef.current = null;
      }
    }
  }, []);

  const value = useMemo(
    () => ({ canInstall: installEvent !== null, install }),
    [install, installEvent]
  );

  return (
    <InstallAppContext.Provider value={value}>
      {children}
    </InstallAppContext.Provider>
  );
}

export function useInstallApp(): InstallAppContextValue {
  const context = useContext(InstallAppContext);
  if (!context) {
    throw new Error('useInstallApp must be used within an InstallProvider');
  }
  return context;
}
