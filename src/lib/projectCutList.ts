// Writes a generated cut list into a project's cut list, one part at a time
// through the existing per-item endpoint. "Replace" only removes the old parts
// after every new part saved, so a failure never leaves the project emptier
// than it started.

export type SaveMode = 'append' | 'replace';

export interface CutListWriter<Item> {
  add: (projectId: number, item: Item & { sort_order: number }) => Promise<unknown>;
  remove: (id: number) => Promise<unknown>;
}

export interface ExistingCutItem {
  id: number;
  sort_order: number;
}

export interface SaveResult {
  total: number;
  added: number;
  /** Old parts removed (replace mode only). */
  removed: number;
  /** Old parts that could not be removed after the new ones saved. */
  removeFailed: number;
  /** Why adding stopped early, if it did. */
  error: string | null;
}

function message(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'The server did not accept the part.';
}

export async function saveCutListToProject<Item>(
  writer: CutListWriter<Item>,
  projectId: number,
  items: Item[],
  existing: ExistingCutItem[],
  mode: SaveMode,
): Promise<SaveResult> {
  const result: SaveResult = { total: items.length, added: 0, removed: 0, removeFailed: 0, error: null };
  // Appended parts sort after everything already there; replacements start fresh.
  // Numbering starts at 1: the cut-list POST treats a sort_order of 0 as unset
  // and substitutes Date.now(), which would push the first part to the end.
  const start = mode === 'append' && existing.length > 0
    ? Math.max(...existing.map(e => Number(e.sort_order) || 0)) + 1
    : 1;

  for (const [index, item] of items.entries()) {
    try {
      await writer.add(projectId, { ...item, sort_order: start + index });
      result.added += 1;
    } catch (err) {
      result.error = message(err);
      return result; // Stop; replace mode leaves the old parts untouched.
    }
  }

  if (mode === 'replace') {
    for (const old of existing) {
      try {
        await writer.remove(old.id);
        result.removed += 1;
      } catch {
        result.removeFailed += 1;
      }
    }
  }
  return result;
}

/** One sentence describing what happened, for the status line. */
export function describeSave(result: SaveResult, projectTitle: string, mode: SaveMode): string {
  const parts = (n: number) => `${n} part${n === 1 ? '' : 's'}`;
  if (result.error) {
    const kept = mode === 'replace' ? ' Its existing parts were left as they were.' : '';
    return result.added === 0
      ? `Nothing was added to “${projectTitle}”: ${result.error}${kept}`
      : `Only ${result.added} of ${parts(result.total)} were added to “${projectTitle}” before it stopped: ${result.error}${kept} `
        + 'Check the project before trying again so parts aren’t duplicated.';
  }
  if (mode === 'replace') {
    const leftover = result.removeFailed > 0
      ? ` ${parts(result.removeFailed)} from the old list couldn’t be removed — delete them on the project page.`
      : '';
    return `Replaced the cut list in “${projectTitle}” with ${parts(result.added)}.${leftover}`;
  }
  return `Added ${parts(result.added)} to “${projectTitle}”.`;
}
