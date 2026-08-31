const BRIDGE_READY = 'WORKSHOP_MAKERWORLD_BRIDGE_READY';
const BRIDGE_PING = 'WORKSHOP_MAKERWORLD_BRIDGE_PING';
const BRIDGE_REQUEST = 'WORKSHOP_MAKERWORLD_BRIDGE_REQUEST';
const BRIDGE_RESULT = 'WORKSHOP_MAKERWORLD_BRIDGE_RESULT';

export interface MakerWorldBridgeRequest {
  designId: string;
  sourceUrl: string;
  submitUrl: string;
  token: string;
  existingSourceKeys: string[];
}

export interface MakerWorldBridgeResult {
  ok: boolean;
  status?: string;
  assetCount?: number;
  warnings?: string[];
  code?: string;
  error?: string;
}

export class MakerWorldBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MakerWorldBridgeError';
    this.code = code;
  }
}

export function subscribeToMakerWorldBridge(onReady: (version: string) => void) {
  const listener = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type !== BRIDGE_READY) return;
    onReady(typeof event.data.version === 'string' ? event.data.version : 'unknown');
  };
  window.addEventListener('message', listener);
  window.postMessage({ type: BRIDGE_PING }, window.location.origin);
  return () => window.removeEventListener('message', listener);
}

export function requestMakerWorldBridge(
  payload: MakerWorldBridgeRequest,
  timeoutMs = 120_000,
): Promise<MakerWorldBridgeResult> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', listener);
      reject(new MakerWorldBridgeError(
        'bridge_timeout',
        'Workshop Bridge timed out. Return to Workshop and try again.',
      ));
    }, timeoutMs);

    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type !== BRIDGE_RESULT || event.data.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', listener);
      const result = event.data.result as MakerWorldBridgeResult | undefined;
      if (!result?.ok) {
        reject(new MakerWorldBridgeError(
          result?.code ?? 'bridge_failed',
          result?.error ?? 'Workshop Bridge could not import MakerWorld files.',
        ));
        return;
      }
      resolve(result);
    };

    window.addEventListener('message', listener);
    window.postMessage({
      type: BRIDGE_REQUEST,
      requestId,
      payload,
    }, window.location.origin);
  });
}
