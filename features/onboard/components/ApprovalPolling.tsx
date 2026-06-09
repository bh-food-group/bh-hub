'use client';

import { useCallback, useEffect, useRef } from 'react';

const INITIAL_INTERVAL_MS = 10_000; // 10s – fewer invocations on Vercel free tier
const MAX_INTERVAL_MS = 60_000;     // cap at 60s

export default function ApprovalPolling() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalMsRef = useRef(INITIAL_INTERVAL_MS);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/user/status');
      if (!res.ok) return;
      const { status } = await res.json();
      if (status !== 'pending_approval') {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        // Hard navigation to the routing hub. The proxy/jwt callback re-reads the
        // now-current status from the DB on this request, so token-based guards
        // route the user correctly. A full reload (not router.replace) avoids
        // reusing a prefetched RSC payload computed under the old status.
        window.location.href = '/';
        return;
      }
    } catch {
      // Retry on next tick
    }
    // Exponential backoff: 10s → 20s → 40s → 60s (capped) – fewer Vercel invocations
    const next = intervalMsRef.current;
    intervalMsRef.current = Math.min(intervalMsRef.current * 2, MAX_INTERVAL_MS);
    timeoutRef.current = setTimeout(checkStatus, next);
  }, []);

  useEffect(() => {
    function runWhenVisible() {
      intervalMsRef.current = INITIAL_INTERVAL_MS;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      checkStatus();
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      } else {
        runWhenVisible();
      }
    }

    runWhenVisible();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [checkStatus]);

  return null;
}
