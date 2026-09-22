import type { AppInfoResponse } from '@shared/ipc-types';
import { useEffect, useState } from 'react';

import { ipc } from '@/lib/ipc';

/** The app's version, runtime and platform, read once from the main process. */
export function useAppInfo(): AppInfoResponse | null {
  const [appInfo, setAppInfo] = useState<AppInfoResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ipc.readAppInfo().then((result) => {
      if (!cancelled && result.ok) {
        setAppInfo(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return appInfo;
}
