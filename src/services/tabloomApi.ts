import type { IPublicClientApplication } from '@azure/msal-browser'
import { getTabloomToken } from '../auth/getTabloomToken'

const BASE = import.meta.env.VITE_TABLOOM_API_BASE_URL as string | undefined

if (!BASE) {
  throw new Error(
    'VITE_TABLOOM_API_BASE_URL must be set in your .env file. ' +
    'See .env.example for reference.'
  )
}

export interface TabloomPageSummary {
  id: string
  title: string
  snippet: string | null
  edited_at: string
}

export interface TabloomPageDetail extends TabloomPageSummary {
  html: string
  body_md: string
}

/**
 * Result of an update or create call. `ok: false` is reserved for the
 * server's optimistic-concurrency 409 response — `current` is the page
 * as Tabloom now sees it, ready to be shown in a "reload or overwrite"
 * prompt without bubbling through the generic error path.
 */
export type WriteResult =
  | { ok: true; page: TabloomPageDetail }
  | { ok: false; reason: 'conflict'; current: TabloomPageDetail }

let msal: IPublicClientApplication | null = null
export function setMsalInstance(instance: IPublicClientApplication) { msal = instance }

async function authHeader(): Promise<string> {
  if (!msal) throw new Error('Tabloom client: MSAL not initialized')
  const token = await getTabloomToken(msal)
  return `Bearer ${token}`
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: await authHeader() },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

async function send<T>(method: 'PUT' | 'POST', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: await authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }))
    const err = new Error(payload.error ?? res.statusText) as Error & {
      status?: number
      payload?: unknown
    }
    err.status = res.status
    err.payload = payload
    throw err
  }
  return res.json() as Promise<T>
}

export const listTabloomWorkshopPages = () =>
  get<TabloomPageSummary[]>('/api/integrations/workshop/pages')

export const getTabloomWorkshopPage = (id: string) =>
  get<TabloomPageDetail>(`/api/integrations/workshop/pages/${encodeURIComponent(id)}`)

/**
 * Save changes to an existing page. The server compares `expected_edited_at`
 * to its current row; on mismatch it returns 409 with the current page and
 * the caller can prompt the user.
 */
export async function updateTabloomWorkshopPage(
  id: string,
  body: { title?: string; body_md: string; expected_edited_at: string },
): Promise<WriteResult> {
  try {
    const page = await send<TabloomPageDetail>(
      'PUT',
      `/api/integrations/workshop/pages/${encodeURIComponent(id)}`,
      body,
    )
    return { ok: true, page }
  } catch (err) {
    const e = err as Error & { status?: number; payload?: { current?: TabloomPageDetail } }
    if (e.status === 409 && e.payload?.current) {
      return { ok: false, reason: 'conflict', current: e.payload.current }
    }
    throw err
  }
}

/**
 * Create a new page in the Workshop notebook in Tabloom. There's no
 * conflict path for create — the only failure modes are auth, validation,
 * or network, all of which bubble as exceptions.
 */
export async function createTabloomWorkshopPage(
  body: { title: string; body_md?: string },
): Promise<TabloomPageDetail> {
  return send<TabloomPageDetail>('POST', '/api/integrations/workshop/pages', body)
}
