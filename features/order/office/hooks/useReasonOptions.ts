'use client';

import { useState, useEffect } from 'react';
import type { ReasonCategory } from '../components/ReasonSelector';

export function useReasonOptions() {
  const [options, setOptions] = useState<ReasonCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/order/reason-options')
      .then((r) => r.json())
      .then((data: { options?: ReasonCategory[] }) => {
        if (Array.isArray(data.options) && data.options.length > 0) {
          setOptions(data.options);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { options, loading };
}
