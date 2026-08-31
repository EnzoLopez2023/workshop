import type { IPublicClientApplication } from '@azure/msal-browser';
import { getApiToken } from '../auth/getToken';
import { isDemoMode, notifyDemoBlock, DemoBlockedError } from '../demo/demoMode';
import type {
  ProjectListItem, ProjectDetail, ProjectFormPayload,
  CutListItem, Material, AnalyzedProject,
  ShaperProject, ShaperProjectPayload, ShaperAnalysisResult,
  BambuAsset, BambuProject, BambuProjectPayload, BambuAnalysisResult, BambuImportResult,
  MakerWorldBridgeJob, MakerWorldBridgeStart,
  ProviderConnections, ThingiverseConnectionStatus,
  BuildLogEntry, FinishLogEntry, ShoppingListItem, TemplateListItem,
} from '../types/project';

const BASE = '/api';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOME_TENANT_ID = import.meta.env.VITE_AZURE_HOME_TENANT_ID
  || import.meta.env.VITE_AZURE_TENANT_ID
  || '';

const DEMO_WRITE_MSG = "You're in demo mode — sign in with Microsoft to save changes.";

let msal: IPublicClientApplication | null = null;
export function setMsalInstance(instance: IPublicClientApplication) { msal = instance; }

// Match the backend's home-preserving tenant namespace for auth-exempt images.
function currentUserKey(): string | null {
  const account = msal?.getActiveAccount() ?? null;
  const oidClaim = account?.idTokenClaims?.oid;
  const oid = typeof oidClaim === 'string' ? oidClaim : (account?.localAccountId ?? '');
  const tid = account?.tenantId ?? '';
  if (!GUID_RE.test(oid) || !GUID_RE.test(tid) || !GUID_RE.test(HOME_TENANT_ID)) return null;
  return tid.toLowerCase() === HOME_TENANT_ID.toLowerCase()
    ? oid.toLowerCase()
    : `${tid.toLowerCase()}_${oid.toLowerCase()}`;
}

// Throw (and toast) if a write is attempted in demo mode — call before any
// mutating request so nothing ever leaves the browser.
function blockIfDemo(): void {
  if (isDemoMode()) {
    notifyDemoBlock(DEMO_WRITE_MSG);
    throw new DemoBlockedError(DEMO_WRITE_MSG);
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!msal) return {};
  const token = await getApiToken(msal);
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase();
  // Demo mode: no token, GET-only against the shared starter snapshot.
  const demo = isDemoMode();
  if (demo && method !== 'GET') blockIfDemo();
  const auth = demo ? { 'X-Demo': '1' } : await authHeaders();
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers: { ...auth, ...(options?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

// ── Account ───────────────────────────────────────────────────────────────────

export const deleteAccount = () =>
  request<{ success: true }>('/account', { method: 'DELETE' });

// ── Projects ──────────────────────────────────────────────────────────────────

export const listProjects = () => request<ProjectListItem[]>('/projects');
export const getProject   = (id: number) => request<ProjectDetail>(`/projects/${id}`);
export const createProject = (p: ProjectFormPayload) =>
  request<ProjectListItem>('/projects', json('POST', p));
export const updateProject = (id: number, p: Partial<ProjectFormPayload>) =>
  request<ProjectListItem>(`/projects/${id}`, json('PUT', p));
export const deleteProject = (id: number) =>
  request<{ success: boolean }>(`/projects/${id}`, { method: 'DELETE' });

export const analyzeProjectUrl = (url: string) =>
  request<AnalyzedProject>('/projects/analyze-url', json('POST', { url }));

// ── Images ────────────────────────────────────────────────────────────────────

export const imageUrl = (id: number) => {
  const userKey = currentUserKey();
  return userKey
    ? `${BASE}/images/${id}?userKey=${encodeURIComponent(userKey)}`
    : `${BASE}/images/${id}`;
};

export const uploadImage = async (
  projectId: number,
  kind: 'sketch' | 'inspiration',
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ id: number }> => {
  blockIfDemo();
  const auth = await authHeaders();
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/projects/${projectId}/images`);
    for (const [k, v] of Object.entries(auth)) xhr.setRequestHeader(k, v);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let msg = xhr.statusText;
        try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch { /* */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  });
};

export const addInspirationUrl = (projectId: number, url: string) =>
  request<{ id: number }>(`/projects/${projectId}/images`, json('POST', { kind: 'inspiration', url }));

export const deleteImage = (id: number) =>
  request<{ success: boolean }>(`/images/${id}`, { method: 'DELETE' });

// ── Cut list ──────────────────────────────────────────────────────────────────

export const addCutItem = (projectId: number, item: Partial<CutListItem>) =>
  request<{ id: number }>(`/projects/${projectId}/cut-list`, json('POST', item));
export const updateCutItem = (id: number, item: Partial<CutListItem>) =>
  request<{ success: boolean }>(`/cut-list/${id}`, json('PUT', item));
export const deleteCutItem = (id: number) =>
  request<{ success: boolean }>(`/cut-list/${id}`, { method: 'DELETE' });

// ── Materials ─────────────────────────────────────────────────────────────────

export const addMaterial = (projectId: number, m: Partial<Material>) =>
  request<{ id: number }>(`/projects/${projectId}/materials`, json('POST', m));
export const updateMaterial = (id: number, m: Partial<Material>) =>
  request<{ success: boolean }>(`/materials/${id}`, json('PUT', m));
export const deleteMaterial = (id: number) =>
  request<{ success: boolean }>(`/materials/${id}`, { method: 'DELETE' });

// ── Cut plan config ───────────────────────────────────────────────────────────

export interface CutPlanConfigPayload { stockRows: unknown[]; kerfStr: string }

export const getCutPlanConfig = (projectId: number) =>
  request<{ config: CutPlanConfigPayload | null }>(`/projects/${projectId}/cut-plan-config`);
export const saveCutPlanConfig = (projectId: number, config: CutPlanConfigPayload) =>
  request<{ success: boolean }>(`/projects/${projectId}/cut-plan-config`, json('PUT', config));

// ── Shaper Hub Projects ───────────────────────────────────────────────────────

export const listShaperProjects = () =>
  request<ShaperProject[]>('/shaper-projects');
export const getShaperProject = (id: number) =>
  request<ShaperProject>(`/shaper-projects/${id}`);
export const createShaperProject = (p: ShaperProjectPayload) =>
  request<ShaperProject>('/shaper-projects', json('POST', p));
export const updateShaperProject = (id: number, p: Partial<ShaperProjectPayload>) =>
  request<ShaperProject>(`/shaper-projects/${id}`, json('PUT', p));
export const deleteShaperProject = (id: number) =>
  request<{ success: boolean }>(`/shaper-projects/${id}`, { method: 'DELETE' });
export const analyzeShaperUrl = (url: string) =>
  request<ShaperAnalysisResult>('/shaper-projects/analyze-url', json('POST', { url }));

export const addShaperImageUrl = (shaperProjectId: number, url: string) =>
  request<{ id: number }>(`/shaper-projects/${shaperProjectId}/images`, json('POST', { kind: 'sketch', url }));

export const uploadShaperImage = async (
  shaperProjectId: number,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ id: number }> => {
  blockIfDemo();
  const auth = await authHeaders();
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('kind', 'sketch');
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/shaper-projects/${shaperProjectId}/images`);
    for (const [k, v] of Object.entries(auth)) xhr.setRequestHeader(k, v);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let msg = xhr.statusText;
        try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch { /* */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  });
};

export const addShaperCutItem = (shaperProjectId: number, item: Partial<CutListItem>) =>
  request<{ id: number }>(`/shaper-projects/${shaperProjectId}/cut-list`, json('POST', item));

// ── Bambu Hub Projects ────────────────────────────────────────────────────────

export const listBambuProjects = () =>
  request<BambuProject[]>('/bambu-projects');
export const getBambuProject = (id: number) =>
  request<BambuProject>(`/bambu-projects/${id}`);
export const analyzeBambuUrl = (url: string) =>
  request<BambuAnalysisResult>('/bambu-projects/analyze-url', json('POST', { url }));
export const createBambuProject = (project: BambuProjectPayload) =>
  request<BambuImportResult>('/bambu-projects', json('POST', project));
export const updateBambuProject = (id: number, project: BambuProjectPayload) =>
  request<BambuProject>(`/bambu-projects/${id}`, json('PUT', project));
export const deleteBambuProject = (id: number) =>
  request<{ success: boolean }>(`/bambu-projects/${id}`, { method: 'DELETE' });

export const bambuAssetUrl = (id: number) => {
  const userKey = currentUserKey();
  return userKey
    ? `${BASE}/bambu-assets/${id}/image?userKey=${encodeURIComponent(userKey)}`
    : `${BASE}/bambu-assets/${id}/image`;
};

export const fetchBambuAsset = async (id: number): Promise<Blob> => {
  const demo = isDemoMode();
  const auth = demo ? { 'X-Demo': '1' } : await authHeaders();
  const response = await fetch(`${BASE}/bambu-assets/${id}`, { headers: auth });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? response.statusText);
  }
  return response.blob();
};

export const uploadBambuAsset = async (
  bambuProjectId: number,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<BambuAsset> => {
  blockIfDemo();
  const auth = await authHeaders();
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/bambu-projects/${bambuProjectId}/assets`);
    for (const [key, value] of Object.entries(auth)) xhr.setRequestHeader(key, value);
    if (onProgress) {
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as BambuAsset);
      } else {
        let message = xhr.statusText;
        try { message = JSON.parse(xhr.responseText).error ?? message; } catch { /* response is not JSON */ }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  });
};

export const deleteBambuAsset = (id: number) =>
  request<{ success: boolean }>(`/bambu-assets/${id}`, { method: 'DELETE' });

export const startMakerWorldBridgeJob = (bambuProjectId: number) =>
  request<MakerWorldBridgeStart>(
    `/bambu-projects/${bambuProjectId}/makerworld-bridge-jobs`,
    { method: 'POST' },
  );

export const getMakerWorldBridgeJob = (bambuProjectId: number, jobId: string) =>
  request<MakerWorldBridgeJob>(
    `/bambu-projects/${bambuProjectId}/makerworld-bridge-jobs/${encodeURIComponent(jobId)}`,
  );

// ── Provider connections ──────────────────────────────────────────────────────

export const getProviderConnections = () =>
  request<ProviderConnections>('/provider-connections');
export const saveThingiverseToken = (token: string) =>
  request<ThingiverseConnectionStatus>(
    '/provider-connections/thingiverse',
    json('PUT', { token }),
  );
export const disconnectThingiverse = () =>
  request<ThingiverseConnectionStatus>(
    '/provider-connections/thingiverse',
    { method: 'DELETE' },
  );

// ── Build log ─────────────────────────────────────────────────────────────────

export const buildLogImageUrl = (entryId: number) => {
  const userKey = currentUserKey();
  return userKey
    ? `${BASE}/build-log/${entryId}/image?userKey=${encodeURIComponent(userKey)}`
    : `${BASE}/build-log/${entryId}/image`;
};

export const addBuildLogEntry = async (
  projectId: number,
  note: string,
  file?: File,
  onProgress?: (pct: number) => void,
): Promise<BuildLogEntry> => {
  blockIfDemo();
  const auth = await authHeaders();
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('note', note);
    if (file) form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/projects/${projectId}/build-log`);
    for (const [k, v] of Object.entries(auth)) xhr.setRequestHeader(k, v);
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else { let msg = xhr.statusText; try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch { /* */ } reject(new Error(msg)); }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  });
};

export const deleteBuildLogEntry = (id: number) =>
  request<{ success: boolean }>(`/build-log/${id}`, { method: 'DELETE' });

// ── Finish log ────────────────────────────────────────────────────────────────

export const addFinishLogEntry = (projectId: number, entry: Omit<FinishLogEntry, 'id' | 'project_id'>) =>
  request<{ id: number }>(`/projects/${projectId}/finish-log`, json('POST', entry));
export const updateFinishLogEntry = (id: number, entry: Partial<FinishLogEntry>) =>
  request<{ success: boolean }>(`/finish-log/${id}`, json('PUT', entry));
export const deleteFinishLogEntry = (id: number) =>
  request<{ success: boolean }>(`/finish-log/${id}`, { method: 'DELETE' });

// ── Shopping list ─────────────────────────────────────────────────────────────

export const getShoppingList = () => request<ShoppingListItem[]>('/shopping-list');
export const togglePurchased = (id: number, purchased: boolean) =>
  request<{ success: boolean }>(`/materials/${id}/purchased`, json('PATCH', { purchased }));

// ── Project links ─────────────────────────────────────────────────────────────

export const addProjectLink = (projectId: number, linked_project_id: number, relationship: string) =>
  request<{ success: boolean }>(`/projects/${projectId}/links`, json('POST', { linked_project_id, relationship }));
export const removeProjectLink = (id: number) =>
  request<{ success: boolean }>(`/project-links/${id}`, { method: 'DELETE' });

// ── Templates ─────────────────────────────────────────────────────────────────

export const listTemplates = () => request<TemplateListItem[]>('/templates');
export const saveAsTemplate = (projectId: number, template_name: string) =>
  request<TemplateListItem>(`/projects/${projectId}/save-as-template`, json('POST', { template_name }));
export const cloneTemplate = (templateId: number, title?: string) =>
  request<ProjectListItem>(`/templates/${templateId}/clone`, json('POST', { title }));
export const deleteTemplate = (id: number) =>
  request<{ success: boolean }>(`/templates/${id}`, { method: 'DELETE' });

// Notebook reads/writes are no longer served by this backend — the Workshop
// notebook UI is a read-only window onto Tabloom's "Workshop" notebook. See
// src/services/tabloomApi.ts.
