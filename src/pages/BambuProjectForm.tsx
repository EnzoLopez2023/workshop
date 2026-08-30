import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Box,
  FileDown,
  Images,
  Loader,
  ScanLine,
} from 'lucide-react';
import {
  analyzeBambuUrl,
  createBambuProject,
  getBambuProject,
  updateBambuProject,
} from '../services/api';
import type { BambuAnalysisResult } from '../types/project';
import { buildBambuProjectPayload } from '../lib/coreWorkflows';
import { Button, PageFrame, PageHeader, StatePanel } from '../components/ui';
import { Field, FormSection } from '../components/workflows';

export default function BambuProjectForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const projectId = id ? Number(id) : null;
  const isEdit = projectId !== null;

  const [sourceUrl, setSourceUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creatorName, setCreatorName] = useState('');
  const [licenseName, setLicenseName] = useState('');
  const [analysis, setAnalysis] = useState<BambuAnalysisResult | null>(null);
  const lastAnalysisRef = useRef<BambuAnalysisResult | null>(null);
  const [previewBroken, setPreviewBroken] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId === null) return;
    getBambuProject(projectId)
      .then(project => {
        setSourceUrl(project.source_url);
        setTitle(project.title);
        setDescription(project.description ?? '');
        setCreatorName(project.creator_name ?? '');
        setLicenseName(project.license_name ?? '');
      })
      .catch(error => setSaveError(error instanceof Error ? error.message : 'Could not load this 3D project.'))
      .finally(() => setLoading(false));
  }, [projectId]);

  const goBack = () => {
    navigate(isEdit ? `/bambu/${projectId}` : '/');
  };

  const handleAnalyze = async () => {
    if (!sourceUrl.trim()) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalysis(null);
    try {
      const result = await analyzeBambuUrl(sourceUrl.trim());
      const previous = lastAnalysisRef.current;
      setAnalysis(result);
      setPreviewBroken(false);
      setTitle(current =>
        !current.trim() || current === previous?.title ? result.title : current
      );
      setDescription(current =>
        !current.trim() || current === previous?.description ? result.description : current
      );
      setCreatorName(current =>
        !current.trim() || current === (previous?.creator_name ?? '')
          ? (result.creator_name ?? '')
          : current
      );
      setLicenseName(current =>
        !current.trim() || current === (previous?.license_name ?? '')
          ? (result.license_name ?? '')
          : current
      );
      lastAnalysisRef.current = result;
    } catch (error) {
      setAnalyzeError(error instanceof Error ? error.message : 'Workshop could not read that model page.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (!sourceUrl.trim()) {
      setSaveError('A MakerWorld, Thingiverse, or Printables URL is required.');
      return;
    }
    if (!title.trim()) {
      setSaveError('Title is required.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    const payload = buildBambuProjectPayload({
      title,
      sourceUrl,
      description,
      creatorName,
      licenseName,
    });
    try {
      if (projectId !== null) {
        await updateBambuProject(projectId, payload);
        navigate(`/bambu/${projectId}`);
      } else {
        const result = await createBambuProject(payload);
        navigate(`/bambu/${result.project.id}`);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Workshop could not save this 3D project.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageFrame maxWidth={860}>
        <StatePanel title="Loading Bambu project" description="Preparing the source details and imported files." />
      </PageFrame>
    );
  }

  return (
    <PageFrame maxWidth={860} className="project-form-page bambu-form-page">
      <div className="form-toolbar">
        <Button variant="ghost" onClick={goBack} className="workflow-back">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </Button>
        <Button variant="primary" onClick={() => void handleSave()} disabled={saving || analyzing}>
          {saving
            ? <><Loader className="spinner" size={16} aria-hidden="true" /> {isEdit ? 'Saving…' : 'Importing files…'}</>
            : isEdit ? 'Save changes' : 'Create Bambu project'}
        </Button>
      </div>

      <PageHeader
        title={isEdit ? 'Edit Bambu Hub project' : 'New Bambu Hub project'}
        description={isEdit
          ? 'Update the project record without replacing its locally saved images and model files.'
          : 'Paste a public MakerWorld, Thingiverse, or Printables URL, review the source, then save every accessible image and model file locally.'}
      />

      {saveError && (
        <StatePanel title="Bambu project needs attention" description={saveError} tone="danger" />
      )}

      <FormSection
        title="Import the 3D project"
        description={isEdit
          ? 'The source must continue to point to the same model. Create a new project to import a different model.'
          : 'Workshop reads the public listing first. File availability depends on each provider’s access rules.'}
      >
        <Field label="Model URL" required>
          <div className="input-action-row">
            <input
              type="url"
              value={sourceUrl}
              onChange={event => {
                setSourceUrl(event.target.value);
                setAnalysis(null);
                setAnalyzeError(null);
              }}
              placeholder="https://www.printables.com/model/…"
              required
            />
            {!isEdit && (
              <Button onClick={() => void handleAnalyze()} disabled={analyzing || !sourceUrl.trim()}>
                {analyzing
                  ? <><Loader className="spinner" size={16} aria-hidden="true" /> Reading…</>
                  : <><ScanLine size={16} aria-hidden="true" /> Read the page</>}
              </Button>
            )}
          </div>
          {analyzeError && (
            <span className="inline-error"><AlertCircle size={16} aria-hidden="true" /> {analyzeError}</span>
          )}
        </Field>

        {analysis && (
          <section className="bambu-import-preview" aria-labelledby="bambu-import-preview-title">
            {analysis.preview_image_url && !previewBroken ? (
              <img
                src={analysis.preview_image_url}
                alt=""
                onError={() => setPreviewBroken(true)}
              />
            ) : (
              <div className="bambu-import-preview-placeholder" aria-hidden="true">
                <Box size={48} strokeWidth={1.35} />
              </div>
            )}
            <div>
              <h3 id="bambu-import-preview-title">{analysis.title || '3D project found'}</h3>
              <p>{providerLabel(analysis.source_site)} model {analysis.source_model_id}</p>
              <dl>
                <div><dt><Images size={15} aria-hidden="true" /> Images</dt><dd>{analysis.image_count}</dd></div>
                <div><dt><FileDown size={15} aria-hidden="true" /> Files</dt><dd>{analysis.file_count}</dd></div>
              </dl>
            </div>
          </section>
        )}

        {analysis && analysis.files.length > 0 && (
          <div className="form-field">
            <span className="form-field-label">Files found on the source</span>
            <ul className="bambu-manifest-list">
              {analysis.files.map((file, index) => (
                <li key={`${file.filename}-${index}`}>
                  <FileDown size={16} aria-hidden="true" />
                  <span>{file.filename}</span>
                  <small>{file.kind === 'model' ? '3D / CAD' : 'Attachment'}</small>
                </li>
              ))}
            </ul>
          </div>
        )}

        {analysis && analysis.warnings.length > 0 && (
          <div className="bambu-import-warning" role="status">
            <AlertTriangle size={19} aria-hidden="true" />
            <div>
              <strong>Some source files need manual download</strong>
              {analysis.warnings.map(warning => <p key={warning}>{warning}</p>)}
            </div>
          </div>
        )}
      </FormSection>

      <FormSection title="Project details" description="Imported text remains editable before and after creation.">
        <Field label="Title" required>
          <input value={title} onChange={event => setTitle(event.target.value)} required />
        </Field>
        <Field label="Description">
          <textarea rows={8} value={description} onChange={event => setDescription(event.target.value)} />
        </Field>
        <div className="form-grid-2">
          <Field label="Creator">
            <input value={creatorName} onChange={event => setCreatorName(event.target.value)} />
          </Field>
          <Field label="License">
            <input value={licenseName} onChange={event => setLicenseName(event.target.value)} />
          </Field>
        </div>
      </FormSection>

      {saving && !isEdit && (
        <div className="bambu-import-progress" role="status" aria-live="polite">
          <Loader className="spinner" size={18} aria-hidden="true" />
          <span>
            <strong>Saving the source locally</strong>
            <small>Large model collections can take a minute. Keep this page open.</small>
          </span>
        </div>
      )}
    </PageFrame>
  );
}

function providerLabel(site: BambuAnalysisResult['source_site']) {
  if (site === 'makerworld') return 'MakerWorld';
  if (site === 'thingiverse') return 'Thingiverse';
  return 'Printables';
}
