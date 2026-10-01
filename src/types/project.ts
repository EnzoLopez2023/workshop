export type ProjectStatus = 'idea' | 'planning' | 'in_progress' | 'completed';
export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export interface ProjectListItem {
  id: number;
  sort_order: number;
  title: string;
  description: string | null;
  source_url: string | null;
  cut_plan_url: string | null;
  status: ProjectStatus;
  difficulty: Difficulty;
  estimated_hours: number;
  wood_types: string[];
  tools_needed: string[];
  parts_count: number;
  total_cost: number;
  hero_image_id: number | null;
  cut_list_names: string | null;
  material_names: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectImage {
  id: number;
  project_id: number | null;
  shaper_project_id?: number | null;
  kind: 'sketch' | 'inspiration';
  image_type: string | null;
  image_url: string | null;
  sort_order: number;
}

export interface CutListItem {
  id: number;
  project_id: number | null;
  part_name: string;
  qty: number;
  length: string | null;
  width: string | null;
  thickness: string | null;
  material: string | null;
  sort_order: number;
}

export interface Material {
  id: number;
  project_id: number;
  name: string;
  qty_label: string | null;
  cost: number;
  purchased: boolean;
  sort_order: number;
}

export interface BuildLogEntry {
  id: number;
  project_id: number;
  note: string;
  file_path: string | null;
  image_type: string | null;
  created_at: string;
}

export interface FinishLogEntry {
  id: number;
  project_id: number;
  product_name: string;
  finish_type: string | null;
  color: string | null;
  coats: number | null;
  notes: string | null;
  applied_at: string;
}

export interface ProjectLink {
  id: number;
  relationship: string;
  linked_id: number;
  linked_title: string;
  linked_status: ProjectStatus;
}

export interface ShoppingListItem extends Material {
  project_title: string;
}

export interface TemplateListItem {
  id: number;
  title: string;
  template_name: string | null;
  description: string | null;
  difficulty: Difficulty;
  estimated_hours: number;
  wood_types: string[];
  tools_needed: string[];
  parts_count: number;
  hero_image_id: number | null;
}

export interface ProjectDetail {
  id: number;
  title: string;
  description: string | null;
  source_url: string | null;
  cut_plan_url: string | null;
  status: ProjectStatus;
  difficulty: Difficulty;
  estimated_hours: number;
  wood_types: string[];
  tools_needed: string[];
  images: ProjectImage[];
  cut_list: CutListItem[];
  materials: Material[];
  total_cost: number;
  parts_count: number;
  build_log: BuildLogEntry[];
  finish_log: FinishLogEntry[];
  links: ProjectLink[];
  created_at: string;
  updated_at: string;
}

export interface ProjectFormPayload {
  title: string;
  description: string;
  source_url: string;
  cut_plan_url: string;
  status: ProjectStatus;
  difficulty: Difficulty;
  estimated_hours: number;
  wood_types: string[];
  tools_needed: string[];
}

export interface AnalyzedProject {
  title: string;
  description: string;
  difficulty: Difficulty;
  estimated_hours: number;
  wood_types: string[];
  tools_needed: string[];
  cut_list: Array<{
    part_name: string;
    qty: number;
    length: string | null;
    width: string | null;
    thickness: string | null;
    material: string | null;
  }>;
  materials: Array<{
    name: string;
    qty_label: string | null;
  }>;
}

// ── Shaper Hub Projects ───────────────────────────────────────────────────────

export interface ShaperMaterial {
  name: string;
  qty: string;
}

export interface ShaperProject {
  id: number;
  sort_order: number;
  is_completed: boolean;
  title: string;
  shaper_url: string;
  description: string | null;
  photo_url: string | null;
  materials: ShaperMaterial[];
  instructions: string | null;
  /** Detail endpoint only — the list response omits these. */
  images?: ProjectImage[];
  cut_list?: CutListItem[];
  /** List endpoint only — denormalized count so cards need no detail fetch. */
  part_count?: number;
  hero_image_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ShaperProjectPayload {
  title: string;
  shaper_url: string;
  description: string | null;
  photo_url: string | null;
  materials: ShaperMaterial[];
  instructions: string | null;
}

export interface ShaperAnalysisResult {
  title: string;
  description: string;
  photo_url: string;
  materials: ShaperMaterial[];
  instructions: string;
  image_urls?: string[];
}

// ── Bambu Hub Projects ────────────────────────────────────────────────────────

export type BambuSourceSite = 'makerworld' | 'thingiverse' | 'printables';
export type BambuAssetKind = 'image' | 'model' | 'file';

export interface BambuAsset {
  id: number;
  bambu_project_id: number;
  kind: BambuAssetKind;
  filename: string;
  content_type: string;
  size_bytes: number;
  original_url: string;
  sort_order: number;
}

export interface BambuProject {
  id: number;
  sort_order: number;
  is_completed: boolean;
  title: string;
  source_url: string;
  source_site: BambuSourceSite;
  source_model_id: string | null;
  description: string | null;
  notes: string;
  creator_name: string | null;
  license_name: string | null;
  import_warnings: string[];
  /** Detail endpoint only — the list response omits these. */
  assets?: BambuAsset[];
  image_count: number;
  file_count: number;
  hero_asset_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface BambuProjectPayload {
  title: string;
  source_url: string;
  description: string | null;
  creator_name: string | null;
  license_name: string | null;
}

export interface HubProjectCompletion {
  is_completed: boolean;
  updated_at: string;
}

export interface BambuAnalysisFile {
  filename: string;
  kind: Exclude<BambuAssetKind, 'image'>;
}

export interface BambuAnalysisResult {
  source_site: BambuSourceSite;
  source_model_id: string | null;
  title: string;
  description: string;
  creator_name: string | null;
  license_name: string | null;
  preview_image_url: string | null;
  image_count: number;
  file_count: number;
  files: BambuAnalysisFile[];
  warnings: string[];
}

export interface BambuImportResult {
  project: BambuProject;
  warnings: string[];
}

export type ThingiverseConnectionSource = 'account' | 'server' | 'none';

export interface ThingiverseConnectionStatus {
  connected: boolean;
  source: ThingiverseConnectionSource;
  storage_configured: boolean;
}

export interface ProviderConnections {
  thingiverse: ThingiverseConnectionStatus;
}

export type MakerWorldBridgeJobStatus = 'waiting' | 'processing' | 'complete' | 'failed';

export interface MakerWorldBridgeJob {
  id: string;
  status: MakerWorldBridgeJobStatus;
  expires_at: string;
  imported_count: number;
  skipped_count: number;
  failed_count: number;
  warnings: string[];
  error: string | null;
}

export interface MakerWorldBridgeStart extends MakerWorldBridgeJob {
  token: string;
  design_id: string;
  source_url: string;
  submit_path: string;
  existing_source_keys: string[];
}

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: 'Idea',
  planning: 'Planning',
  in_progress: 'In Progress',
  completed: 'Completed',
};

// Notebook types removed: Workshop's notebook view is now sourced from
// Tabloom. See src/services/tabloomApi.ts for the active types.

// ── Library hub (3D model files indexed from the owner's Mac) ─────────────────

export type LibraryStatus = 'inbox' | 'want' | 'queued' | 'printed' | 'failed' | 'skip';

export const LIBRARY_STATUS_LABELS: Record<LibraryStatus, string> = {
  inbox: 'Inbox',
  want: 'Want to print',
  queued: 'Queued',
  printed: 'Printed',
  failed: 'Failed',
  skip: 'Skipped',
};

export interface LibraryFilament {
  type: string | null;
  color: string | null;
  profile?: string | null;
  grams?: number | null;
}

export interface LibraryModel {
  id: string;
  title: string;
  category: string;
  folder: string | null;
  status: LibraryStatus;
  tags: string[];
  notes: string;
  favorite: boolean;
  designer: string | null;
  license: string | null;
  description: string | null;
  source_site: string | null;
  source_url: string | null;
  source_model_id: string | null;
  thumb_hash: string | null;
  gallery: string[];
  formats: string[];
  file_count: number;
  total_bytes: number;
  plate_count: number;
  printer: string | null;
  filaments: LibraryFilament[];
  est_seconds: number | null;
  est_grams: number | null;
  is_sliced: boolean;
  bbox: [number, number, number] | null;
  bambu_project_id: number | null;
  state: 'present' | 'missing';
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
  printed_count: number;
  failed_count: number;
  last_printed_at: string | null;
}

export interface LibraryPlate {
  index: number;
  name: string | null;
  objects?: string[];
  seconds?: number | null;
  grams?: number | null;
}

export interface LibraryFile {
  id: number;
  rel_path: string;
  filename: string;
  kind: 'stl' | '3mf' | 'obj' | 'step' | 'other';
  size: number;
  sha256: string;
  geom_hash: string | null;
  mtime: string | null;
  triangles: number | null;
  bbox: [number, number, number] | null;
  is_sliced: boolean;
  printer: string | null;
  seconds: number | null;
  grams: number | null;
  plates: LibraryPlate[];
  filaments: LibraryFilament[];
  generator: string | null;
  thumb_hash: string | null;
}

export interface LibraryPrint {
  id: number;
  model_id: string | null;
  source: 'manual' | 'shapepilot';
  title: string | null;
  result: 'completed' | 'failed' | 'active' | 'unknown';
  started_at: string | null;
  ended_at: string | null;
  seconds: number | null;
  grams: number | null;
  printer: string | null;
  notes: string;
  match_state: 'manual' | 'auto' | 'confirmed' | 'suggested' | 'unmatched' | 'rejected';
  match_score: number | null;
  model_title?: string | null;
  model_thumb?: string | null;
}

export interface LibraryModelDetail extends LibraryModel {
  files: LibraryFile[];
  prints: LibraryPrint[];
}

export interface LibraryModelPage {
  total: number;
  items: LibraryModel[];
}

export interface LibraryBatch {
  batch: string;
  at: string;
  ops: number;
  undone: boolean;
  kind: string | null;
}

export interface LibraryDevice {
  id: number;
  name: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface LibraryOverview {
  byStatus: Partial<Record<LibraryStatus, number>>;
  byCategory: { category: string; count: number }[];
  missing: number;
  suggestions: number;
  duplicateGroups: number;
  lastSync: { at: string; device: string; stats: { models: number; files: number } | null } | null;
  planSummary: { createdAt: string; pending: number; summary: LibraryPlanSummary } | null;
  batches: LibraryBatch[];
  devices: LibraryDevice[];
  printHistory: { available: boolean; lastSync: string | null };
}

export interface LibraryPlanSummary {
  models: number;
  moves: number;
  extracts: number;
  trash: number;
  trashBytes: number;
  alreadyOrganized: number;
  byCategory: Record<string, number>;
}

export interface LibraryPlanModel {
  id: string;
  title: string;
  origin: 'library' | 'intake';
  sourceLabel: string;
  category: string;
  suggestedCategory: string | null;
  status: LibraryStatus;
  dest: string | null;
  thumb: string | null;
  designer: string | null;
  moves: { from: string; to: string }[];
  moveCount: number;
  extractCount: number;
  trash: { path: string; reason: string }[];
  trashCount: number;
}

export interface LibraryPlan {
  createdAt: string;
  intakeOnly: boolean;
  summary: LibraryPlanSummary;
  skipped: number;
  models: LibraryPlanModel[];
}

export interface LibraryDuplicateGroup {
  geom_hash: string;
  files: {
    id: number;
    model_id: string;
    rel_path: string;
    filename: string;
    kind: string;
    size: number;
    thumb_hash: string | null;
    title: string;
    category: string;
    status: LibraryStatus;
    model_thumb: string | null;
  }[];
}

export interface LibraryModelQuery {
  q?: string;
  status?: string;
  category?: string;
  format?: string;
  tag?: string;
  state?: 'present' | 'missing';
  favorite?: boolean;
  sort?: 'recent' | 'title' | 'updated' | 'printed' | 'size';
  limit?: number;
  offset?: number;
}
