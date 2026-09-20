import { useEffect, useRef, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { Button, IconButton } from './ui';

interface LibraryProject {
  id: number;
  title: string;
}

interface Props<T extends LibraryProject> {
  projects: T[];
  reordering: boolean;
  saving: boolean;
  onReorder: (ids: number[]) => void;
  renderProject: (project: T) => ReactNode;
  renderActions?: (project: T) => ReactNode;
}

export default function ProjectLibraryGrid<T extends LibraryProject>({
  projects,
  reordering,
  saving,
  onReorder,
  renderProject,
  renderActions,
}: Props<T>) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = projects.map(project => project.id);
  const moveProject = (from: number, to: number) => {
    if (saving || from < 0 || to < 0 || to >= ids.length || from === to) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onReorder(arrayMove(ids, from, to));
  };

  useEffect(() => {
    if (saving || !returnFocusRef.current) return;
    const previous = returnFocusRef.current;
    returnFocusRef.current = null;
    if (document.activeElement !== document.body || !previous.isConnected) return;
    if (previous instanceof HTMLButtonElement && previous.disabled) {
      previous.closest('.project-order-buttons')?.querySelector<HTMLButtonElement>('.project-drag-handle')?.focus();
    } else {
      previous.focus();
    }
  }, [saving]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (!reordering || !over) return;
        moveProject(ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id)));
      }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="project-library-grid" aria-busy={saving}>
          {projects.map((project, index) => (
            <SortableProject
              key={project.id}
              project={project}
              reordering={reordering}
              saving={saving}
              first={index === 0}
              last={index === projects.length - 1}
              onMove={direction => moveProject(index, index + direction)}
              actions={renderActions?.(project)}
            >
              {renderProject(project)}
            </SortableProject>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableProject({
  project,
  reordering,
  saving,
  first,
  last,
  onMove,
  actions,
  children,
}: {
  project: LibraryProject;
  reordering: boolean;
  saving: boolean;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
    disabled: !reordering || saving,
  });
  const title = project.title || 'Untitled project';

  return (
    <article
      ref={setNodeRef}
      className={`project-library-item${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {children}
      {(reordering || actions) && (
        <div className="project-library-actions">
          {actions}
          {reordering && (
            <div className="project-order-buttons" role="group" aria-label={`Order ${title}`}>
              <Button
                ref={setActivatorNodeRef}
                variant="ghost"
                className="project-drag-handle"
                {...attributes}
                {...listeners}
                disabled={saving}
                aria-label={`Drag to reorder ${title}`}
                title="Drag to reorder, or press Space and use the arrow keys"
              >
                <GripVertical size={18} aria-hidden="true" />
              </Button>
              <IconButton
                label={`Move ${title} earlier`}
                disabled={saving || first}
                onClick={() => onMove(-1)}
              >
                <ArrowUp size={18} aria-hidden="true" />
              </IconButton>
              <IconButton
                label={`Move ${title} later`}
                disabled={saving || last}
                onClick={() => onMove(1)}
              >
                <ArrowDown size={18} aria-hidden="true" />
              </IconButton>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
