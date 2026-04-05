'use client';

/**
 * @module hooks/useWelcomeScreen
 *
 * S6.1: Controls visibility of the first-login welcome screen.
 *
 * The welcome screen is shown when:
 *   - `has_seen_welcome` is not set in localStorage
 *   - The user has not dismissed it this session
 *
 * Once dismissed (or after first book add), the flag is persisted
 * so it never shows again.
 */

import { useState, useCallback, useSyncExternalStore } from 'react';

export const WELCOME_SEEN_KEY = 'has_seen_welcome';

function getSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  return !localStorage.getItem(WELCOME_SEEN_KEY);
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

export function useWelcomeScreen() {
  const notSeen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [dismissed, setDismissed] = useState(false);

  const showWelcome = notSeen && !dismissed;

  const dismissWelcome = useCallback(() => {
    localStorage.setItem(WELCOME_SEEN_KEY, new Date().toISOString());
    setDismissed(true);
  }, []);

  return { showWelcome, dismissWelcome };
}
