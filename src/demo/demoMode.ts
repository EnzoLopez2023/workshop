/**
 * Workshop — demo-mode flag.
 *
 * Demo mode lets an anonymous visitor browse the whole app against the shared
 * starter dataset (the same snapshot new users are seeded with). It is
 * read-only: the API layer (src/services/api.ts) sends GETs with an `X-Demo`
 * header and blocks every write before it leaves the browser.
 *
 * The flag lives in sessionStorage so it survives a reload (AuthGuard re-reads
 * it during render) but never leaks into a future browser session.
 */

import { toast } from 'sonner';

const DEMO_KEY = 'workshop_demo_v1';

export function isDemoMode(): boolean {
  try { return sessionStorage.getItem(DEMO_KEY) === '1'; } catch { return false; }
}

export function enterDemoMode(): void {
  try { sessionStorage.setItem(DEMO_KEY, '1'); } catch { /* noop */ }
}

export function exitDemoMode(): void {
  try { sessionStorage.removeItem(DEMO_KEY); } catch { /* noop */ }
}

/**
 * Thrown by src/services/api.ts when a write is attempted in demo mode. Call
 * sites that surface `err.message` will show it; `notifyDemoBlock` also fires a
 * toast directly so the message shows even where the error is swallowed.
 */
export class DemoBlockedError extends Error {
  readonly demoBlocked = true;
  constructor(message: string) {
    super(message);
    this.name = 'DemoBlockedError';
  }
}

let lastToastAt = 0;
/** Friendly toast for a blocked demo action (throttled to avoid stacking). */
export function notifyDemoBlock(msg: string): void {
  const now = Date.now();
  if (now - lastToastAt < 1500) return;
  lastToastAt = now;
  try { toast.info(msg); } catch { /* noop */ }
}
