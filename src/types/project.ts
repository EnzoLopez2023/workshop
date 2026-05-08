export type ProjectStatus = 'idea' | 'planning' | 'in_progress' | 'completed';
export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export interface ProjectListItem {
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
  title: string;
  shaper_url: string;
  description: string | null;
  photo_url: string | null;
  materials: ShaperMaterial[];
  instructions: string | null;
  images: ProjectImage[];
  cut_list: CutListItem[];
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

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: 'Idea',
  planning: 'Planning',
  in_progress: 'In Progress',
  completed: 'Completed',
};
