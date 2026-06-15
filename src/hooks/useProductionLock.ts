import { useState, useRef, useCallback } from 'react';

export interface UseProductionLockReturn {
  unlockedEnvIds: Record<string, boolean>;
  autoLockRemaining: number | null;
  isLocked: (envId: string) => boolean;
  toggleUnlock: (envId: string) => void;
  resetLock: (envId: string) => void;
}

export function useProductionLock(
  lockEnabled: boolean,
  lockTimeoutMinutes: number,
  setStatus: (msg: string) => void,
): UseProductionLockReturn {
  const [unlockedEnvIds, setUnlockedEnvIds] = useState<Record<string, boolean>>({});
  const [autoLockRemaining, setAutoLockRemaining] = useState<number | null>(null);
  const autoLockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearAutoLockTimer = useCallback(() => {
    if (autoLockTimerRef.current) {
      clearInterval(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }
    setAutoLockRemaining(null);
  }, []);

  const startAutoLockTimer = useCallback(
    (envId: string) => {
      if (autoLockTimerRef.current) clearInterval(autoLockTimerRef.current);
      let remaining = lockTimeoutMinutes * 60;
      setAutoLockRemaining(remaining);
      autoLockTimerRef.current = setInterval(() => {
        setAutoLockRemaining((prev) => {
          if (prev === null || prev <= 1) {
            if (autoLockTimerRef.current) clearInterval(autoLockTimerRef.current);
            setUnlockedEnvIds((prevState) => ({ ...prevState, [envId]: false }));
            setAutoLockRemaining(null);
            setStatus('⚠️ 生产环境安全锁已自动回锁');
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    },
    [lockTimeoutMinutes, setStatus],
  );

  const toggleUnlock = useCallback(
    (envId: string) => {
      setUnlockedEnvIds((prev) => {
        const newUnlocked = !prev[envId];
        if (newUnlocked) {
          startAutoLockTimer(envId);
        } else {
          clearAutoLockTimer();
        }
        return { ...prev, [envId]: newUnlocked };
      });
    },
    [startAutoLockTimer, clearAutoLockTimer],
  );

  const isLocked = useCallback(
    (envId: string): boolean => {
      return lockEnabled && !unlockedEnvIds[envId];
    },
    [lockEnabled, unlockedEnvIds],
  );

  const resetLock = useCallback(
    (envId: string) => {
      setUnlockedEnvIds((prev) => ({ ...prev, [envId]: false }));
      clearAutoLockTimer();
    },
    [clearAutoLockTimer],
  );

  return {
    unlockedEnvIds,
    autoLockRemaining,
    isLocked,
    toggleUnlock,
    resetLock,
  };
}
