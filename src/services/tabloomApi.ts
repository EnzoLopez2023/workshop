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
}

let msal: IPublicClientApplication | null = null
export function setMsalInstance(instance: IPublicClientApplication) { msal = instance }

async function get<T>(path: string): Promise<T> {
  if (!msal) throw new Error('Tabloom client: MSAL not initialized')
  const token = await getTabloomToken(msal)
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const listTabloomWorkshopPages = () =>
  get<TabloomPageSummary[]>('/api/integrations/workshop/pages')

export const getTabloomWorkshopPage = (id: string) =>
  get<TabloomPageDetail>(`/api/integrations/workshop/pages/${encodeURIComponent(id)}`)
