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

/** A Shelf Builder design saved on a project (all lengths in inches). */
export interface StoredShelfDesign {
  version: 1;
  units: 'in' | 'mm';
  heightMode?: 'opening' | 'overall';
  config: object;
}

/** A Drawer Builder design saved on a project or in the library (all lengths in inches). */
export interface StoredDrawerDesign {
  version: 1;
  kind: 'drawer-unit';
  units: 'in' | 'mm';
  heightMode: 'overall' | 'fronts';
  config: object;
}

/** A named design in the Shelf Builder library. */
export interface LibraryShelfDesign {
  id: number;
  name: string;
  design: unknown;
  created_at: string;
  updated_at: string;
}

/** A named design in the Drawer Builder library (same shape as a shelf design). */
export type LibraryDrawerDesign = LibraryShelfDesign;

/** A Built-in Studio project as listed: its cabinets are counted, not loaded. */
export interface BuiltinProjectSummary {
  id: number;
  name: string;
  has_room: boolean;
  cabinet_count: number;
  placed_count: number;
  created_at: string;
  updated_at: string;
}

/** Where a cabinet sits in the room's top view: its footprint centre in inches and a clockwise turn. */
export interface BuiltinPlacement {
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
}

/** One cabinet in a project — a saved design, placed or not. Several can share a design. */
export interface BuiltinProjectCabinet {
  id: number;
  design_id: number;
  label: string;
  placement: BuiltinPlacement | null;
  design: { id: number; name: string; design: unknown; updated_at: string };
}

export interface BuiltinProject {
  id: number;
  name: string;
  /** The room, read with readRoom() in src/lib/builtinRoom.ts; null until one is set up. */
  room: unknown;
  cabinets: BuiltinProjectCabinet[];
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

// Library hub types removed: the model Library moved to ShapePilot.
