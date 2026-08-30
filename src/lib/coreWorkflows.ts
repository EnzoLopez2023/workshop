import type {
  ProjectListItem,
  ProjectFormPayload,
  ProjectStatus,
  BambuProject,
  BambuProjectPayload,
  ShaperMaterial,
  ShaperProject,
  ShaperProjectPayload,
  ShoppingListItem,
} from '../types/project';

export type ProjectStatusFilter = 'all' | ProjectStatus;
export type ProjectSort = 'updated' | 'created' | 'title';

export interface ShoppingProjectGroup {
  id: number;
  title: string;
  items: ShoppingListItem[];
  outstandingCount: number;
  outstandingCost: number;
}

export const PROJECT_STATUS_ORDER: readonly ProjectStatus[] = [
  'idea',
  'planning',
  'in_progress',
  'completed',
];

export const PROJECT_NEXT_ACTION: Record<ProjectStatus, { title: string; description: string }> = {
  idea: {
    title: 'Shape the idea',
    description: 'Add dimensions, materials, and references that turn the idea into a buildable plan.',
  },
  planning: {
    title: 'Finish the plan',
    description: 'Review the cut list and materials so the project is ready for the shop.',
  },
  in_progress: {
    title: 'Continue the build',
    description: 'Check the plan, record progress, or log the next useful shop step.',
  },
  completed: {
    title: 'Review the finished build',
    description: 'Keep the final notes, finish schedule, and lessons ready for the next version.',
  },
};

function includesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return values.join(' ').toLocaleLowerCase().includes(normalized);
}

export function filterProjects(
  projects: ProjectListItem[],
  status: ProjectStatusFilter,
  query: string,
  includeCompletedInAll = true,
): ProjectListItem[] {
  return projects.filter(project =>
    (status === 'all' || project.status === status)
    && (status !== 'all' || includeCompletedInAll || project.status !== 'completed')
    && includesQuery([
      project.title,
      project.description,
      project.wood_types.join(' '),
      project.cut_list_names,
      project.material_names,
    ], query),
  );
}

export function sortProjects(
  projects: ProjectListItem[],
  sort: ProjectSort,
): ProjectListItem[] {
  return [...projects].sort((left, right) => {
    if (sort === 'title') return left.title.localeCompare(right.title);
    const field = sort === 'created' ? 'created_at' : 'updated_at';
    return new Date(right[field]).getTime() - new Date(left[field]).getTime();
  });
}

export function filterShaperProjects(projects: ShaperProject[], query: string): ShaperProject[] {
  return projects.filter(project => includesQuery([
    project.title,
    project.description,
    ...(project.materials ?? []).map(material => material.name),
  ], query));
}

export function filterBambuProjects(projects: BambuProject[], query: string): BambuProject[] {
  return projects.filter(project => includesQuery([
    project.title,
    project.description,
    project.creator_name,
    project.license_name,
    project.source_site,
  ], query));
}

export function selectFocusProject(projects: ProjectListItem[]): ProjectListItem | undefined {
  const priority: ProjectStatus[] = ['in_progress', 'planning', 'idea', 'completed'];
  return priority
    .map(status => projects.find(project => project.status === status))
    .find((project): project is ProjectListItem => Boolean(project));
}

export function groupShoppingItems(
  items: ShoppingListItem[],
  query: string,
  includePurchased: boolean,
): ShoppingProjectGroup[] {
  const groups = new Map<number, ShoppingProjectGroup>();
  for (const item of items) {
    if (!includePurchased && item.purchased) continue;
    if (!includesQuery([item.name, item.qty_label, item.project_title], query)) continue;
    const group = groups.get(item.project_id) ?? {
      id: item.project_id,
      title: item.project_title,
      items: [],
      outstandingCount: 0,
      outstandingCost: 0,
    };
    group.items.push(item);
    if (!item.purchased) {
      group.outstandingCount += 1;
      group.outstandingCost += item.cost || 0;
    }
    groups.set(item.project_id, group);
  }
  return [...groups.values()];
}

export function shoppingSummary(items: ShoppingListItem[]) {
  const outstanding = items.filter(item => !item.purchased);
  return {
    outstandingCount: outstanding.length,
    purchasedCount: items.length - outstanding.length,
    outstandingCost: outstanding.reduce((total, item) => total + (item.cost || 0), 0),
  };
}

export function commaSeparatedValues(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

export function buildProjectPayload(
  form: ProjectFormPayload,
  woodInput: string,
  toolsInput: string,
): ProjectFormPayload {
  return {
    ...form,
    title: form.title.trim(),
    wood_types: commaSeparatedValues(woodInput),
    tools_needed: commaSeparatedValues(toolsInput),
  };
}

export function buildShaperProjectPayload(input: {
  title: string;
  shaperUrl: string;
  description: string;
  photoUrl: string;
  materials: ShaperMaterial[];
  instructions: string;
}): ShaperProjectPayload {
  return {
    title: input.title.trim(),
    shaper_url: input.shaperUrl.trim(),
    description: input.description.trim() || null,
    photo_url: input.photoUrl.trim() || null,
    materials: input.materials
      .filter(material => material.name.trim())
      .map(material => ({ name: material.name.trim(), qty: material.qty.trim() })),
    instructions: input.instructions.trim() || null,
  };
}

export function buildBambuProjectPayload(input: {
  title: string;
  sourceUrl: string;
  description: string;
  creatorName: string;
  licenseName: string;
}): BambuProjectPayload {
  return {
    title: input.title.trim(),
    source_url: input.sourceUrl.trim(),
    description: input.description.trim() || null,
    creator_name: input.creatorName.trim() || null,
    license_name: input.licenseName.trim() || null,
  };
}
