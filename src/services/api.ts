import type { IPublicClientApplication } from '@azure/msal-browser';
import { getApiToken } from '../auth/getToken';
import type {
  ProjectListItem, ProjectDetail, ProjectFormPayload,
  CutListItem, Material, AnalyzedProject,
  ShaperProject, ShaperProjectPayload, ShaperAnalysisResult,
  BuildLogEntry, FinishLogEntry, ShoppingListItem, TemplateListItem,
} from '../types/project';

const BASE = '/api';

let msal: IPublicClientApplication | null = null;
export function setMsalInstance(instance: IPublicClientApplication) { msal = instance; }

async function authHeaders(): Promise<Record<string, string>> {
  if (!msal) return {};
  const token = await getApiToken(msal);
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const auth = await authHeaders();
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

export const imageUrl = (id: number) => `${BASE}/images/${id}`;

export const uploadImage = async (
  projectId: number,
  kind: 'sketch' | 'inspiration',
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ id: number }> => {
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

// ── Build log ─────────────────────────────────────────────────────────────────

export const buildLogImageUrl = (entryId: number) => `${BASE}/build-log/${entryId}/image`;

export const addBuildLogEntry = async (
  projectId: number,
  note: string,
  file?: File,
  onProgress?: (pct: number) => void,
): Promise<BuildLogEntry> => {
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

