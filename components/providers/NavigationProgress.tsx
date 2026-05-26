'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type NavigationProgressContextValue = {
  startNavigation: () => void;
};

const NavigationProgressContext = createContext<NavigationProgressContextValue | null>(null);

export function useNavigationProgress() {
  const ctx = useContext(NavigationProgressContext);
  return ctx;
}

export function NavigationProgressProvider({ children }: { children: React.ReactNode }) {
  const [isNavigating, setIsNavigating] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prevLocationRef = useRef<string | null>(null);

  const startNavigation = useCallback(() => {
    setIsNavigating(true);
  }, []);

  useEffect(() => {
    const locationKey = pathname + '?' + searchParams.toString();
    if (prevLocationRef.current !== null && prevLocationRef.current !== locationKey) {
      setIsNavigating(false);
    }
    prevLocationRef.current = locationKey;
  }, [pathname, searchParams]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const link = (e.target as HTMLElement).closest('a');
      if (!link?.href) return;
      if (link.target === '_blank' || link.rel?.includes('external')) return;
      // Blob / download links do not change the route; synthetic a.click() would otherwise leave the overlay stuck.
      if (link.hasAttribute('download')) return;
      try {
        const url = new URL(link.href);
        if (url.protocol === 'blob:') return;
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      } catch {
        return;
      }
      startNavigation();
    }
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [startNavigation]);

  return (
    <NavigationProgressContext.Provider value={{ startNavigation }}>
      {isNavigating && (
        <div className="fixed top-0 left-0 right-0 z-50 h-0.5 bg-primary/20">
          <div className="h-full bg-primary animate-progress-bar" />
        </div>
      )}
      {children}
    </NavigationProgressContext.Provider>
  );
}
