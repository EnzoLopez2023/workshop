import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Download,
  ExternalLink,
  FileArchive,
  Images,
  Loader,
  Pencil,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  bambuAssetUrl,
  deleteBambuProject,
  fetchBambuAsset,
  getBambuProject,
  uploadBambuAsset,
} from '../services/api';
import { isDemoMode } from '../demo/demoMode';
import type { BambuAsset, BambuProject } from '../types/project';
import { Button, PageFrame, StatePanel } from '../components/ui';
import { WorkflowSection } from '../components/workflows';
import { ProjectDetailSkeleton } from '../components/Skeleton';

const MAX_BAMBU_UPLOAD_BYTES = 250 * 1024 * 1024;

export default function BambuProjectDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [project, setProject] = useState<BambuProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [heroBroken, setHeroBroken] = useState(false);
  const [lightbox, setLightbox] = useState<BambuAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const demo = isDemoMode();

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getBambuProject(projectId)
      .then(setProject)
      .catch(error => {
        console.error('Bambu project load failed', error);
        setLoadError('Workshop could not load this Bambu Hub project. Check the connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteBambuProject(projectId);
      navigate('/');
    } catch (error) {
      console.error('Bambu project delete failed', error);
      toast.error('Workshop could not delete this Bambu project. Try again.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) return;
    const oversized = selected.find(file => file.size > MAX_BAMBU_UPLOAD_BYTES);
    if (oversized) {
      setUploadStatus('');
      setUploadError(`${oversized.name} exceeds the 250 MB per-file limit.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setUploadStatus('');
    setUploadError('');
    try {
      for (const [index, file] of selected.entries()) {
        await uploadBambuAsset(projectId, file, progress => {
          const completed = index / selected.length;
          setUploadProgress(Math.round((completed + (progress / 100 / selected.length)) * 100));
        });
      }
      setUploadProgress(100);
      setUploadStatus(`${selected.length} file${selected.length === 1 ? '' : 's'} added to this project.`);
      load();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Workshop could not upload those files.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (file: BambuAsset) => {
    setDownloadingId(file.id);
    try {
      const blob = await fetchBambuAsset(file.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Workshop could not download that file.');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) return <ProjectDetailSkeleton />;
  if (loadError) {
    return (
      <PageFrame maxWidth={980}>
        <StatePanel
          title="Bambu project unavailable"
          description={loadError}
          tone="danger"
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      </PageFrame>
    );
  }
  if (!project) {
    return (
      <PageFrame maxWidth={980}>
        <StatePanel title="Bambu project not found" description="This project may have been deleted or the link is no longer valid." />
      </PageFrame>
    );
  }

  const assets = project.assets ?? [];
  const images = assets.filter(asset => asset.kind === 'image');
  const files = assets.filter(asset => asset.kind !== 'image');
  const hero = images[0] ? bambuAssetUrl(images[0].id) : null;

  return (
    <>
      <PageFrame maxWidth={1000} className="project-detail-page bambu-detail-page">
        <div className="project-detail-toolbar">
          <Button variant="ghost" onClick={() => navigate('/')} className="workflow-back">
            <ArrowLeft size={16} aria-hidden="true" /> Bambu Hub
          </Button>
          <div className="project-detail-actions">
            <Button variant="ghost" onClick={() => navigate(`/bambu/${projectId}/edit`)}>
              <Pencil size={16} aria-hidden="true" /> Edit
            </Button>
            {confirmDelete ? (
              <span className="inline-confirm" role="group" aria-label="Confirm Bambu project deletion">
                <span>Delete this project and its saved files?</span>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                <Button variant="danger" onClick={() => void handleDelete()} disabled={deleting}>
                  <Trash2 size={16} aria-hidden="true" />
                  {deleting ? 'Deleting…' : 'Delete'}
                </Button>
              </span>
            ) : (
              <Button variant="ghost" className="danger-text" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} aria-hidden="true" /> Delete
              </Button>
            )}
          </div>
        </div>

        <section className="project-detail-hero bambu-detail-hero" aria-labelledby="bambu-project-title">
          <div className="project-detail-hero-media">
            {hero && !heroBroken ? (
              <img src={hero} alt="" onError={() => setHeroBroken(true)} />
            ) : (
              <div className="project-plan-fallback" aria-hidden="true">
                <Box size={64} strokeWidth={1.3} />
              </div>
            )}
          </div>
          <div className="project-detail-tracing">
            <span className="pill flag-steel"><Box size={14} aria-hidden="true" /> Bambu Hub · {providerLabel(project.source_site)}</span>
            <h1 id="bambu-project-title">{project.title || 'Untitled 3D project'}</h1>
            {project.description && <p className="project-detail-description">{project.description}</p>}
            <a className="shaper-source-link" href={project.source_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} aria-hidden="true" /> Open the source on {providerLabel(project.source_site)}
            </a>
            <dl className="project-detail-meta">
              <div><dt><Images size={14} aria-hidden="true" /> Images</dt><dd>{images.length}</dd></div>
              <div><dt><FileArchive size={14} aria-hidden="true" /> Files</dt><dd>{files.length}</dd></div>
              <div><dt>Creator</dt><dd>{project.creator_name || 'Unknown'}</dd></div>
              <div><dt>License</dt><dd>{project.license_name || 'Not listed'}</dd></div>
            </dl>
            <div className="project-next-action">
              <span>
                <strong>{files.length > 0 ? 'Take the model to your slicer' : 'Complete the source files'}</strong>
                <small>
                  {files.length > 0
                    ? 'Download the locally saved STL, 3MF, CAD, or attachment you need.'
                    : 'This provider did not expose a public model download. Follow the source link to retrieve it manually.'}
                </small>
              </span>
              {files[0] && (
                <Button
                  variant="next"
                  onClick={() => void handleDownload(files[0])}
                  disabled={downloadingId !== null}
                >
                  {downloadingId === files[0].id
                    ? <Loader className="spinner" size={16} aria-hidden="true" />
                    : <Download size={16} aria-hidden="true" />}
                  {downloadingId === files[0].id ? 'Preparing download…' : 'Download first file'}
                </Button>
              )}
            </div>
          </div>
        </section>

        <div className="project-detail-content">
          {project.import_warnings.length > 0 && (
            <div className="bambu-import-warning bambu-detail-warning" role="status">
              <AlertTriangle size={19} aria-hidden="true" />
              <div>
                <strong>Import completed with provider limits</strong>
                {project.import_warnings.map(warning => <p key={warning}>{warning}</p>)}
              </div>
            </div>
          )}

          {images.length > 0 && (
            <WorkflowSection
              id="bambu-images"
              title="Saved images"
              description={`${images.length} source image${images.length === 1 ? '' : 's'} copied into this Workshop project.`}
            >
              <div className="media-gallery">
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    className="media-gallery-item"
                    onClick={() => setLightbox(image)}
                    aria-label={`Open source image ${index + 1}`}
                  >
                    <img src={bambuAssetUrl(image.id)} alt="" />
                  </button>
                ))}
              </div>
            </WorkflowSection>
          )}

          <WorkflowSection
            id="bambu-files"
            title="Saved model files"
            description={files.length > 0
              ? `${files.length} file${files.length === 1 ? '' : 's'} stored locally and ready to download.`
              : 'No model files could be copied from this provider.'}
            actions={!demo ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="sr-only"
                  accept=".3mf,.amf,.blend,.dwg,.dxf,.f3d,.fbx,.gcode,.iges,.igs,.obj,.pdf,.ply,.scad,.step,.stl,.stp,.zip,.7z,.rar"
                  onChange={event => void handleUpload(event)}
                />
                <Button variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading
                    ? <Loader className="spinner" size={16} aria-hidden="true" />
                    : <Upload size={16} aria-hidden="true" />}
                  {uploading ? 'Uploading…' : 'Add files'}
                </Button>
              </>
            ) : undefined}
          >
            {(uploading || uploadStatus || uploadError) && (
              <div
                className={`bambu-upload-status ${uploadError ? 'is-error' : ''}`}
                role={uploadError ? 'alert' : 'status'}
                aria-live="polite"
              >
                {uploading && (
                  <span className="bambu-upload-track" aria-label={`${uploadProgress}% uploaded`}>
                    <span style={{ transform: `scaleX(${uploadProgress / 100})` }} />
                  </span>
                )}
                <span>{uploading ? `${uploadProgress}% uploaded` : uploadError || uploadStatus}</span>
              </div>
            )}
            {files.length > 0 ? (
              <div className="bambu-file-list">
                {files.map(file => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => void handleDownload(file)}
                    disabled={downloadingId !== null}
                  >
                    <span className="bambu-file-icon" aria-hidden="true"><FileArchive size={20} /></span>
                    <span>
                      <strong>{file.filename}</strong>
                      <small>{fileLabel(file)} · {formatBytes(file.size_bytes)}</small>
                    </span>
                    {downloadingId === file.id
                      ? <Loader className="spinner" size={18} aria-hidden="true" />
                      : <Download size={18} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            ) : (
              <p className="section-placeholder">
                Open the source page to download protected files, then use Add files to keep them with this project.
              </p>
            )}
          </WorkflowSection>
        </div>
      </PageFrame>

      {lightbox && (
        <ImageLightbox
          src={bambuAssetUrl(lightbox.id)}
          label={lightbox.filename}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

function providerLabel(site: BambuProject['source_site']) {
  if (site === 'makerworld') return 'MakerWorld';
  if (site === 'thingiverse') return 'Thingiverse';
  return 'Printables';
}

function fileLabel(file: BambuAsset) {
  const extension = file.filename.split('.').pop()?.toUpperCase();
  return extension || (file.kind === 'model' ? '3D model' : 'Attachment');
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function ImageLightbox({
  src,
  label,
  onClose,
}: {
  src: string;
  label: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <div
      className="media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          event.preventDefault();
          closeRef.current?.focus();
        }
      }}
    >
      <Button ref={closeRef} variant="ghost" className="media-lightbox-close" onClick={onClose} aria-label="Close preview">
        <X size={20} aria-hidden="true" />
      </Button>
      <img src={src} alt={label} onClick={event => event.stopPropagation()} />
    </div>
  );
}
