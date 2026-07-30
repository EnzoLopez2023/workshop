import { useEffect, useRef, useState } from 'react'
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  AnimatePresence,
} from 'framer-motion'
import { useMsal } from '@azure/msal-react'
import {
  ArrowRight, Check, Link2, Lock, PlayCircle,
  Ruler, Hammer, BookOpen, ShoppingCart, Camera, Cpu,
  ShieldCheck, Smartphone, Save, Contrast,
} from 'lucide-react'
import { loginRequest } from './msalConfig'
import { enterDemoMode } from '../demo/demoMode'
import SplitFlap from '../components/SplitFlap'
import '../styles/landing.css'

// ─── Data ─────────────────────────────────────────────────────────────────────

const HERO_ROWS = [
  { name: 'Walnut Floating Shelf', stock: 'Walnut · Cherry', parts: '06', est: '12H' },
  { name: 'Garage Workbench',      stock: 'Douglas Fir',     parts: '14', est: '28H' },
  { name: 'Cedar Planter Box',     stock: 'Red Cedar',       parts: '08', est: '06H' },
]

// The lifecycle a project actually moves through, in order.
const CYCLE = ['IDEA', 'PLANNING', 'IN PROGRESS', 'COMPLETE'] as const
const TONE: Record<(typeof CYCLE)[number], 'ink' | 'amber' | 'green'> = {
  'IDEA': 'ink',
  'PLANNING': 'ink',
  'IN PROGRESS': 'amber',
  'COMPLETE': 'green',
}

const PILLARS = [
  {
    Icon: Ruler,
    label: 'Plan',
    headline: 'Cut lists that do the math.',
    body: 'Enter your dimensions and available stock — Workshop generates an optimized cut plan, calculates waste, and tells you exactly how many boards to buy.',
  },
  {
    Icon: Hammer,
    label: 'Build',
    headline: 'Log every step, forget nothing.',
    body: 'Timestamped build entries with photos and finish records. Your complete project history — what you used, what worked, what to do differently next time.',
  },
  {
    Icon: BookOpen,
    label: 'Curate',
    headline: 'Import projects, not screenshots.',
    body: 'Paste a Shaper Hub link and Workshop extracts the full part list automatically. A connected notebook keeps your ideas and reference material alongside every build.',
  },
]

const SUPPORTING = [
  { Icon: ShoppingCart, title: 'Shopping List',  desc: 'Materials consolidated across every active build. Check items off as you shop.' },
  { Icon: Camera,       title: 'Finish Records', desc: 'Log your stain, topcoat, and application notes. Never forget what worked.' },
  { Icon: BookOpen,     title: 'Notebook',       desc: 'A connected freeform layer for ideas, reference material, and project notes.' },
  { Icon: Cpu,          title: 'Shaper Hub',     desc: 'Direct import from Shaper Origin projects — parts, dimensions, bit info pre-filled.' },
]

const DETAILS = [
  { Icon: ShieldCheck, title: 'Private by default', desc: 'Microsoft SSO — your existing account, no new password.' },
  { Icon: Smartphone,  title: 'Works everywhere',   desc: 'Responsive across phone, tablet, and desktop.' },
  { Icon: Save,        title: 'Instant save',       desc: 'Every change persisted automatically. Nothing slips through.' },
  { Icon: Contrast,    title: 'Two renditions',     desc: 'The board reads the same in a lit shop or a dark one.' },
]

// Fixed board-fill percentages per project — no Math.random
const DEMO_PROJECTS = [
  { url: 'shaper.studio/projects/walnut-floating-shelf',   name: 'Walnut Floating Shelf', parts: 6,  boards: 2, hours: 12, materials: 'Walnut, Cherry', cuts: [91, 76] },
  { url: 'shaper.studio/projects/garage-workbench-v2',     name: 'Garage Workbench',      parts: 14, boards: 5, hours: 28, materials: 'Douglas Fir',    cuts: [95, 82, 68, 90, 58] },
  { url: 'woodworking.com/plan/cedar-planter-raised-bed',  name: 'Cedar Planter Box',     parts: 8,  boards: 2, hours: 6,  materials: 'Red Cedar',      cuts: [87, 73] },
]

// ─── Microsoft logo ────────────────────────────────────────────────────────────
function MsLogo({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 21 21" style={{ width: size, height: size, flexShrink: 0 }} aria-hidden>
      <rect x="1"  y="1"  width="9" height="9" rx="0.5" fill="#F25022" />
      <rect x="11" y="1"  width="9" height="9" rx="0.5" fill="#7FBA00" />
      <rect x="1"  y="11" width="9" height="9" rx="0.5" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" rx="0.5" fill="#FFB900" />
    </svg>
  )
}

// ─── The departures board ──────────────────────────────────────────────────────
// Three real projects, and the status column rolling through the lifecycle each
// one actually travels. Under reduced motion the board simply stands still.
function DeparturesBoard() {
  const reduce = useReducedMotion() ?? false
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (reduce) return
    const t = setInterval(() => setTick(n => n + 1), 2800)
    return () => clearInterval(t)
  }, [reduce])

  return (
    <div className="departures board">
      <div className="rail riveted departures-rail">
        <span>Departures</span>
        <span className="rail-count">Live</span>
      </div>

      <div className="departures-head">
        <span>Project</span>
        <span>Stock</span>
        <span>Parts</span>
        <span>Est.</span>
        <span>Status</span>
      </div>

      {HERO_ROWS.map((row, i) => {
        const status = CYCLE[(tick + i) % CYCLE.length]
        return (
          <div className="departures-row" key={row.name}>
            <span className="board-caps departures-name">{row.name}</span>
            <span className="departures-cell">{row.stock}</span>
            <span className="departures-cell readout">{row.parts}</span>
            <span className="departures-cell readout">{row.est}</span>
            <SplitFlap value={status.padEnd(11, ' ')} label={status} size="sm" tone={TONE[status]} />
          </div>
        )
      })}
    </div>
  )
}

// ─── URL paste demo ────────────────────────────────────────────────────────────
type DemoPhase = 'idle' | 'pasted' | 'loading' | 'results'

function UrlPasteDemo() {
  const [idx, setIdx]     = useState(0)
  const [phase, setPhase] = useState<DemoPhase>('idle')
  const project           = DEMO_PROJECTS[idx]

  useEffect(() => {
    setPhase('idle')
    const timers = [
      setTimeout(() => setPhase('pasted'),  900),
      setTimeout(() => setPhase('loading'), 1600),
      setTimeout(() => setPhase('results'), 2700),
      setTimeout(() => setIdx((i) => (i + 1) % DEMO_PROJECTS.length), 6800),
    ]
    return () => timers.forEach(clearTimeout)
  }, [idx])

  return (
    <div className="paste-demo board">
      <div className="rail">
        <Link2 size={12} strokeWidth={2.4} />
        <span>URL Import</span>
      </div>

      <div className="paste-body">
        <div className={`paste-field${phase !== 'idle' ? ' paste-field--active' : ''}`}>
          <div className="paste-url-area">
            <AnimatePresence mode="wait">
              {phase === 'idle' ? (
                <motion.span
                  key="ph" className="paste-placeholder"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  Paste a Shaper Hub URL…
                </motion.span>
              ) : (
                // URL appears all-at-once — this is paste, not typing
                <motion.span
                  key="url" className="paste-url-text"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ duration: 0.1 }}
                >
                  {project.url}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence mode="wait">
            {phase === 'pasted' && (
              <motion.div
                key="btn" className="paste-analyze"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
              >
                Analyze
              </motion.div>
            )}
            {phase === 'loading' && (
              <motion.div
                key="spin" className="paste-spinner"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              >
                <motion.span
                  className="paste-spin-ring"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.85, repeat: Infinity, ease: 'linear' }}
                />
              </motion.div>
            )}
            {phase === 'results' && (
              <motion.div
                key="check" className="paste-check"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ duration: 0.16 }}
              >
                <Check size={13} strokeWidth={3} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {phase === 'results' && (
            <motion.div
              className="paste-results"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.28 }}
            >
              <div className="board-caps paste-result-name">{project.name}</div>

              <div className="paste-stats">
                {[
                  { v: String(project.parts).padStart(2, '0'), l: 'Parts' },
                  { v: String(project.boards).padStart(2, '0'), l: 'Boards' },
                  { v: `${project.hours}H`, l: 'Est. time' },
                  { v: project.materials, l: 'Materials' },
                ].map(s => (
                  <div className="paste-stat" key={s.l}>
                    <span className="stat-label">{s.l}</span>
                    <span className="readout paste-stat-val">{s.v}</span>
                  </div>
                ))}
              </div>

              <div className="paste-cut-plan">
                <span className="stat-label">Cut plan generated</span>
                <div className="paste-boards">
                  {project.cuts.map((pct, i) => (
                    <div key={i} className="paste-board-row">
                      <motion.span
                        className="paste-board-fill"
                        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                        transition={{ delay: 0.25 + i * 0.12, duration: 0.4, ease: 'easeOut' }}
                        style={{ width: `${pct}%` }}
                      />
                      <span className="paste-board-waste" style={{ width: `${100 - pct}%` }} />
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { instance } = useMsal()
  const heroRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion() ?? false

  // Let the landing page scroll
  useEffect(() => {
    document.body.style.overflow = 'auto'
    document.body.style.height   = 'auto'
    return () => {
      document.body.style.overflow = ''
      document.body.style.height   = ''
    }
  }, [])

  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] })
  const heroY = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '10%'])

  const signIn = () => instance.loginRedirect(loginRequest)
  // Flip the demo flag, then reload so AuthGuard re-reads it and renders the app.
  const startDemo = () => { enterDemoMode(); window.location.reload() }

  return (
    <div className="landing-root">
      <div className="landing-field" aria-hidden />

      {/* ── Steel band ───────────────────────────────────────────────────── */}
      <nav className="landing-nav">
        <span className="landing-brand">
          <img className="landing-brand-mark" src="/favicon.svg" alt="" />
          <span>
            <span className="landing-brand-name">The Workshop</span>
            <span className="landing-brand-sub">Project Companion</span>
          </span>
        </span>
        <button className="btn btn-primary" onClick={signIn}>
          <Lock size={12} strokeWidth={2.4} /> Sign in
        </button>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <motion.section className="landing-hero" ref={heroRef} style={{ y: heroY }}>
        <div className="landing-hero-copy">
          <motion.h1
            className="landing-h1"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            Your whole shop,<br />on one board.
          </motion.h1>

          <motion.p
            className="landing-sub measure"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.44 }}
          >
            A single-user companion for woodworking. Cut lists, build logs,
            Shaper Hub imports, and an AI that fills in the details — so you
            can spend less time planning and more time building.
          </motion.p>

          <motion.div
            className="landing-cta"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <div className="landing-cta-row">
              <button className="btn btn-primary landing-cta-btn" onClick={signIn}>
                <MsLogo size={16} />
                Sign in with Microsoft
                <ArrowRight size={14} className="cta-arrow" />
              </button>
              <button className="btn btn-ghost landing-cta-btn" onClick={startDemo}>
                <PlayCircle size={16} strokeWidth={2.2} />
                Demo
              </button>
            </div>
            <p className="landing-cta-note">
              Sign in with a Microsoft account — or explore the demo, no account needed
            </p>
          </motion.div>
        </div>

        <motion.div
          className="landing-hero-board"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <DeparturesBoard />
        </motion.div>
      </motion.section>

      {/* ── Plan / Build / Curate ────────────────────────────────────────── */}
      <section className="landing-section">
        <div className="board">
          <div className="rail riveted">
            <span>What it does</span>
            <span className="rail-count">03</span>
          </div>
          {PILLARS.map(({ Icon, label, headline, body }, i) => (
            <motion.div
              key={label}
              className="pillar-row"
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: i * 0.07, duration: 0.4 }}
            >
              <span className="pillar-label">
                <Icon size={14} strokeWidth={2.2} />
                {label}
              </span>
              <span className="pillar-text">
                <span className="board-caps pillar-headline">{headline}</span>
                <span className="pillar-body">{body}</span>
              </span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── URL import ───────────────────────────────────────────────────── */}
      <section className="landing-section landing-import">
        <motion.div
          className="import-copy"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.45 }}
        >
          <h2 className="landing-h2">Drop a link.<br />Get a cut plan.</h2>
          <p className="measure landing-body">
            Paste any Shaper Hub project URL. Workshop's AI reads the page,
            extracts every part and dimension, and generates your cut list —
            ready to print and take to the shop.
          </p>
          <ul className="import-list">
            <li>Parts, dimensions, and bit info auto-extracted</li>
            <li>Cut plan optimized for your available stock</li>
            <li>Materials and build-time estimate included</li>
          </ul>
        </motion.div>

        <motion.div
          className="import-demo"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.45, delay: 0.08 }}
        >
          <UrlPasteDemo />
        </motion.div>
      </section>

      {/* ── Everything else ──────────────────────────────────────────────── */}
      <section className="landing-section">
        <div className="board">
          <div className="rail riveted">
            <span>Also on board</span>
            <span className="rail-count">{String(SUPPORTING.length + DETAILS.length).padStart(2, '0')}</span>
          </div>
          {[...SUPPORTING, ...DETAILS].map(({ Icon, title, desc }) => (
            <div className="feature-row" key={title}>
              <span className="feature-name">
                <Icon size={14} strokeWidth={2.2} className="feature-icon" />
                <span className="board-caps">{title}</span>
              </span>
              <span className="feature-desc">{desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <section className="landing-section">
        <motion.div
          className="landing-close steel riveted"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45 }}
        >
          <img className="landing-close-mark" src="/favicon.svg" alt="" />
          <h2 className="landing-close-h2">Your next project is waiting.</h2>
          <p className="landing-close-sub">
            Sign in with your Microsoft account to open your workshop.
          </p>
          <button className="btn btn-primary landing-cta-btn" onClick={signIn}>
            <MsLogo size={16} />
            Sign in with Microsoft
            <ArrowRight size={14} className="cta-arrow" />
          </button>
          <p className="landing-close-note">workshop.enzolopez.net · Personal workspace</p>
        </motion.div>
      </section>
    </div>
  )
}
