/**
 * Runtime capability probe. GitHub Pages cannot send COOP/COEP headers, so
 * SharedArrayBuffer is normally unavailable there; the engine must never require it.
 * `canUseSharedMemory` exists so a future transport (SAB ring buffer) can be enabled
 * opportunistically on hosts that do send the headers.
 */
export interface Capabilities {
  webgpu: boolean;
  workers: boolean;
  canUseSharedMemory: boolean;
  hardwareConcurrency: number;
}

export function detectCapabilities(): Capabilities {
  return {
    webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    workers: typeof Worker !== 'undefined',
    canUseSharedMemory:
      typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
    hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1,
  };
}
