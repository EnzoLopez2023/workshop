import { useState } from 'react';
import { Check, Circle, Loader } from 'lucide-react';
import { toast } from 'sonner';
import { isDemoMode } from '../demo/demoMode';
import { updateHubProjectCompletion } from '../services/api';
import type { HubProjectCompletion } from '../types/project';
import { Button } from './ui';

interface Props {
  library: 'shaper' | 'bambu';
  project: { id: number; title: string; is_completed: boolean };
  disabled?: boolean;
  onChange: (completion: HubProjectCompletion) => void;
}

export default function HubCompletionButton({ library, project, disabled, onChange }: Props) {
  const [saving, setSaving] = useState(false);
  const demo = isDemoMode();
  const completedLabel = library === 'bambu' ? 'Printed' : 'Created (CNC cut)';
  const actionLabel = library === 'bambu' ? 'Mark as printed' : 'Mark as created';

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const completion = await updateHubProjectCompletion(library, project.id, !project.is_completed);
      onChange(completion);
    } catch (error) {
      console.error('Project completion update failed', error);
      toast.error(error instanceof Error ? error.message : 'Workshop could not save this project status. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button
      variant="ghost"
      className="hub-completion-button"
      aria-pressed={project.is_completed}
      aria-label={`${project.is_completed ? completedLabel : actionLabel}: ${project.title || 'Untitled project'}`}
      title={demo
        ? 'Sign in to change project status'
        : project.is_completed ? 'Mark as unfinished' : actionLabel}
      disabled={demo || disabled || saving}
      onClick={() => void toggle()}
    >
      {saving
        ? <Loader size={16} className="spinner" aria-hidden="true" />
        : project.is_completed ? <Check size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
      {saving ? 'Saving…' : project.is_completed ? completedLabel : actionLabel}
    </Button>
  );
}
