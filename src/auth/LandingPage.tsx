import { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import {
  ArrowRight,
  BookOpen,
  Box,
  Check,
  ClipboardList,
  Cpu,
  Hammer,
  Link2,
  LockKeyhole,
  PlayCircle,
  Ruler,
  ShoppingCart,
} from 'lucide-react';
import { enterDemoMode } from '../demo/demoMode';
import { loginRequest } from './msalConfig';
import '../styles/landing.css';

const WORKFLOW = [
  {
    title: 'Capture the plan',
    description: 'Start blank or paste a plan URL, then keep the dimensions, materials, tools, and references editable.',
    icon: <Link2 size={19} aria-hidden="true" />,
  },
  {
    title: 'Prepare the build',
    description: 'Turn the cut list into a stock layout and carry every unpurchased material into one shopping list.',
    icon: <Ruler size={19} aria-hidden="true" />,
  },
  {
    title: 'Keep the record',
    description: 'Add build notes, photographs, finish details, and project links so the work still makes sense later.',
    icon: <ClipboardList size={19} aria-hidden="true" />,
  },
];

const CONNECTED_TOOLS = [
  { icon: <ShoppingCart size={18} />, title: 'Shopping List', copy: 'Materials grouped by the project that needs them.' },
  { icon: <BookOpen size={18} />, title: 'Notebook', copy: 'A browser editor connected to the Workshop notebook in Tabloom.' },
  { icon: <Cpu size={18} />, title: 'Shaper Hub', copy: 'A separate project context for Origin references, parts, and instructions.' },
  { icon: <Box size={18} />, title: 'Bambu Hub', copy: '3D model pages, source images, and accessible print files saved together.' },
  { icon: <Ruler size={18} />, title: 'Conversion Tables', copy: 'Exact millimeter, decimal-inch, and fractional references.' },
];

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" className="microsoft-mark" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" rx="0.5" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" rx="0.5" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" rx="0.5" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" rx="0.5" fill="#FFB900" />
    </svg>
  );
}

export default function LandingPage() {
  const { instance } = useMsal();
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');

  const signIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    setAuthError('');
    try {
      await instance.loginRedirect(loginRequest);
    } catch (error) {
      console.error('Microsoft sign-in failed', error);
      setSigningIn(false);
      setAuthError('Microsoft sign-in could not start. Check the connection and try again.');
    }
  };

  const startDemo = () => {
    enterDemoMode();
    window.location.reload();
  };

  return (
    <main className="landing-root">
      <div className="landing-field" aria-hidden="true" />

      <header className="landing-header">
        <a className="landing-brand" href="#landing-main" aria-label="Workshop home">
          <img className="landing-brand-mark" src="/apple-touch-icon.png" alt="" width={44} height={44} />
          <span>
            <strong>Workshop</strong>
            <small>Project Companion</small>
          </span>
        </a>
        <button className="btn btn-ghost" type="button" onClick={() => void signIn()} disabled={signingIn}>
          <LockKeyhole size={16} aria-hidden="true" />
          Sign in
        </button>
      </header>

      <section className="landing-hero" id="landing-main">
        <div className="landing-hero-copy">
          <h1>Keep the whole build connected.</h1>
          <p>
            Workshop keeps a woodworking project together from first idea through
            dimensions, materials, cuts, shopping, build notes, and finish records.
          </p>
          <div className="landing-actions">
            <button className="btn btn-primary" type="button" onClick={() => void signIn()} disabled={signingIn}>
              <MicrosoftMark />
              {signingIn ? 'Opening Microsoft…' : 'Sign in with Microsoft'}
              {!signingIn && <ArrowRight size={16} aria-hidden="true" />}
            </button>
            <button className="btn btn-muted" type="button" onClick={startDemo} disabled={signingIn}>
              <PlayCircle size={17} aria-hidden="true" />
              Browse read-only demo
            </button>
          </div>
          <p className="landing-auth-note">
            Sign in uses your Microsoft account. The demo needs no account and cannot save changes.
          </p>
          {authError && <p className="landing-auth-error" role="alert">{authError}</p>}
        </div>

        <div className="landing-plan" aria-label="Example active project plan">
          <div className="landing-plan-drawing" aria-hidden="true">
            <span className="landing-dimension is-width">36&quot;</span>
            <span className="landing-dimension is-depth">8&quot;</span>
            <Hammer size={52} strokeWidth={1.35} />
          </div>
          <div className="landing-tracing-sheet">
            <span className="landing-status"><Check size={14} aria-hidden="true" /> Planning</span>
            <h2>Walnut floating shelf</h2>
            <p>Dimensions and stock are ready. Complete the cut list before buying boards.</p>
            <dl>
              <div><dt>Parts</dt><dd>6</dd></div>
              <div><dt>Stock</dt><dd>Walnut</dd></div>
            </dl>
            <span className="landing-next-action">Complete cut list</span>
          </div>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="landing-workflow-title">
        <header className="landing-section-heading">
          <h2 id="landing-workflow-title">One record from plan to finish</h2>
          <p>The project stays editable at every stage; generated structure never replaces the maker's judgment.</p>
        </header>
        <div className="landing-workflow">
          {WORKFLOW.map(item => (
            <article key={item.title}>
              <span>{item.icon}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" aria-labelledby="landing-tools-title">
        <header className="landing-section-heading">
          <h2 id="landing-tools-title">Tools stay one route away</h2>
          <p>Browser-native links, forms, tables, downloads, print, keyboard focus, and history remain intact.</p>
        </header>
        <div className="landing-tool-list">
          {CONNECTED_TOOLS.map(item => (
            <article key={item.title}>
              <span aria-hidden="true">{item.icon}</span>
              <div><h3>{item.title}</h3><p>{item.copy}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-closing">
        <div>
          <img className="landing-closing-mark" src="/apple-touch-icon.png" alt="" width={48} height={48} />
          <div>
            <h2>Open your workshop.</h2>
            <p>Continue a project or explore the seeded demo workspace.</p>
          </div>
        </div>
        <div className="landing-closing-actions">
          <button className="btn btn-primary" type="button" onClick={() => void signIn()} disabled={signingIn}>
            <MicrosoftMark />
            Sign in with Microsoft
          </button>
          <button className="btn btn-ghost" type="button" onClick={startDemo} disabled={signingIn}>
            Demo
          </button>
        </div>
      </section>
    </main>
  );
}
