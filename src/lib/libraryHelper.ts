// Client for the Library helper that runs on the owner's Mac
// (tools/library-scanner `serve`, http://localhost:47821). It is only
// reachable from that Mac; everywhere else the file actions are hidden and the
// Library stays a read/write catalog backed by the Workshop server.

import { useCallback, useEffect, useState } from 'react';
import type { LibraryBatch, LibraryStatus } from '../types/project';

const HELPER = 'http://localhost:47821';

export interface HelperHealth {
  ok: boolean;
  version: number;
  library: string;
  connected: boolean;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${HELPER}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const libraryHelper = {
  health: () => call<HelperHealth>('/health'),
  categories: () => call<{ categories: string[] }>('/categories'),
  batches: () => call<{ batches: LibraryBatch[] }>('/batches'),
  open: (modelId: string, relPath?: string) => call<{ ok: true }>('/open', { modelId, relPath }),
  reveal: (modelId: string, relPath?: string) => call<{ ok: true }>('/reveal', { modelId, relPath }),
  file: (modelId: string, category: string, status?: LibraryStatus) =>
    call<{ batch: string; dir: string }>('/file', { modelId, category, status }),
  trashFile: (modelId: string, relPath: string) => call<{ batch: string }>('/trash-file', { modelId, relPath }),
  applyPlan: (ids: string[]) =>
    call<{ batch: string; results: { id: string; title: string; ok: boolean; error?: string }[] }>('/apply-plan', { ids }),
  undo: (batch: string) => call<{ reversed: number }>('/undo', { batch }),
  sync: () => call<{ models: number; edits: number; planModels: number }>('/sync', {}),
  fileUrl: (modelId: string, relPath: string) =>
    `${HELPER}/file?modelId=${encodeURIComponent(modelId)}&relPath=${encodeURIComponent(relPath)}`,
};

/** Detects the helper once per mount; `null` while checking. */
export function useLibraryHelper() {
  const [health, setHealth] = useState<HelperHealth | null | false>(null);
  const check = useCallback(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    fetch(`${HELPER}/health`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : false))
      .then(setHealth)
      .catch(() => setHealth(false))
      .finally(() => clearTimeout(timer));
  }, []);
  useEffect(check, [check]);
  return { available: Boolean(health), checking: health === null, health: health || null, recheck: check };
}
