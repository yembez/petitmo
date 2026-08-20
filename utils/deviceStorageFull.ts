/** Code stable pour l’UI (`t('bookOrder.storageFull')`). */
export const DEVICE_STORAGE_FULL = 'DEVICE_STORAGE_FULL';

/** Disque / quota iOS saturé (AsyncStorage, sandbox, PDF local). */
export function isDeviceStorageFullError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (!msg) return false;
  if (msg === DEVICE_STORAGE_FULL) return true;
  return (
    /No space left on device/i.test(msg) ||
    /ENOSPC/i.test(msg) ||
    /NSPOSIXErrorDomain Code=28/i.test(msg) ||
    /NSCocoaErrorDomain Code=640/i.test(msg) ||
    /Failed to write manifest/i.test(msg) ||
    /volume .+ est satur/i.test(msg) ||
    /not enough (disk )?space/i.test(msg)
  );
}

export function rethrowIfDeviceStorageFull(err: unknown): void {
  if (isDeviceStorageFullError(err)) {
    throw new Error(DEVICE_STORAGE_FULL);
  }
}
