import { useEffect, useRef, useState } from 'react'
import {
  motion,
  useScroll,
  useTransform,
  AnimatePresence,
  type Variants,
} from 'framer-motion'
import { useMsal } from '@azure/msal-react'
import { Hammer, ArrowRight, Lock } from 'lucide-react'
import { loginRequest } from './msalConfig'
import '../styles/landing.css'

// ─── Data ─────────────────────────────────────────────────────────────────────

const HERO_CARDS = [
  { title: 'Walnut Floating Shelf', status: 'In Progress', parts: 6,  hours: '~12h', accent: '#A0522D' },
  { title: 'Garage Workbench',      status: 'Planning',    parts: 14, hours: '~28h', accent: '#7C3E1F' },
  { title: 'Cedar Planter Box',     status: 'Complete',    parts: 8,  hours: '6h',   accent: '#5a7a3a' },
]

// Fixed board-fill percentages per project — no Math.random
const DEMO_PROJECTS = [
  {
    url:       'shaper.studio/projects/walnut-floating-shelf',
    name:      'Walnut Floating Shelf',
    parts:     6,
    boards:    2,
    hours:     12,
    materials: 'Walnut, Cherry',
    cuts:      [91, 76],
  },
  {
    url:       'shaper.studio/projects/garage-workbench-v2',
    name:      'Garage Workbench',
    parts:     14,
    boards:    5,
    hours:     28,
    materials: 'Douglas Fir',
    cuts:      [95, 82, 68, 90, 58],
  },
  {
    url:       'woodworking.com/plan/cedar-planter-raised-bed',
    name:      'Cedar Planter Box',
    parts:     8,
    boards:    2,
    hours:     6,
    materials: 'Red Cedar',
    cuts:      [87, 73],
  },
]

const SUPPORTING = [
  { icon: '🛒', title: 'Shopping List',   desc: 'Materials consolidated across every active build. Check items off as you shop.' },
  { icon: '📷', title: 'Finish Records',  desc: 'Log your stain, topcoat, and application notes. Never forget what worked.' },
  { icon: '📖', title: 'Notebook',        desc: 'A connected freeform layer for ideas, reference material, and project notes.' },
  { icon: '🔗', title: 'Shaper Hub',      desc: 'Direct import from Shaper Origin projects — parts, dimensions, bit info pre-filled.' },
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

// ─── Hero project cards ────────────────────────────────────────────────────────
// Three staggered, slightly-rotated cards — like project folders spread on a bench.
const ROTATIONS = [-2.5, 0.5, 2]

function HeroCards() {
  return (
    <div className="hero-cards">
      {HERO_CARDS.map((card, i) => (
        <motion.div
          key={card.title}
          className="hero-card"
          style={{ '--card-accent': card.accent } as React.CSSProperties}
          initial={{ opacity: 0, y: 28, rotate: ROTATIONS[i] }}
          animate={{ opacity: 1, y: 0, rotate: ROTATIONS[i] }}
          transition={{
            delay: 0.38 + i * 0.11,
            duration: 0.55,
            type: 'spring',
            stiffness: 260,
            damping: 22,
          }}
        >
          <div className="hero-card-status">
            <span className="hero-card-dot" style={{ background: card.accent }} />
            <span style={{ color: card.accent }}>{card.status}</span>
          </div>
          <div className="hero-card-title">{card.title}</div>
          <div className="hero-card-meta">
            <span>{card.parts} parts</span>
            <span className="hero-card-sep">·</span>
            <span>{card.hours} est.</span>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ─── URL paste demo ────────────────────────────────────────────────────────────
// Accurately shows a URL being *pasted* (instant appearance, not typed)
// then a loading state, then extracted project data + animated cut plan.
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
    <div className="paste-demo">
      {/* ── URL input row ── */}
      <div className="paste-field-wrap">
        <div className={`paste-field${phase !== 'idle' ? ' paste-field--active' : ''}`}>
          <span className="paste-icon">🔗</span>

          <div className="paste-url-area">
            <AnimatePresence mode="wait">
              {phase === 'idle' ? (
                <motion.span
                  key="ph"
                  className="paste-placeholder"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  Paste a Shaper Hub URL…
                </motion.span>
              ) : (
                // URL appears all-at-once — this is paste, not typing
                <motion.span
                  key="url"
                  className="paste-url-text"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.1 }}
                >
                  {project.url}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {/* Right-side state indicators */}
          <AnimatePresence mode="wait">
            {phase === 'pasted' && (
              <motion.div
                key="btn"
                className="paste-analyze-btn"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.18 }}
              >
                Analyze ✨
              </motion.div>
            )}
            {phase === 'loading' && (
              <motion.div
                key="spin"
                className="paste-spinner-wrap"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  className="paste-spin-ring"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.85, repeat: Infinity, ease: 'linear' }}
                />
              </motion.div>
            )}
            {phase === 'results' && (
              <motion.div
                key="check"
                className="paste-check"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                ✓
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Extracted results ── */}
      <AnimatePresence>
        {phase === 'results' && (
          <motion.div
            className="paste-results"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
          >
            <div className="paste-result-name">{project.name}</div>

            {/* Stats grid */}
            <div className="paste-stats">
              {[
                { v: String(project.parts),     l: 'Parts'     },
                { v: String(project.boards),    l: 'Boards'    },
                { v: `${project.hours}h`,       l: 'Est. time' },
                { v: project.materials,         l: 'Materials' },
              ].map((s, i) => (
                <motion.div
                  key={s.l}
                  className="paste-stat"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                >
                  <span className="paste-stat-val">{s.v}</span>
                  <span className="paste-stat-lbl">{s.l}</span>
                </motion.div>
              ))}
            </div>

            {/* Animated cut plan bars */}
            <div className="paste-cut-plan">
              <span className="paste-cut-lbl">Cut plan generated</span>
              <div className="paste-boards">
                {project.cuts.map((pct, i) => (
                  <div key={i} className="paste-board-row">
                    <motion.div
                      className="paste-board-fill"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{
                        delay: 0.25 + i * 0.12,
                        duration: 0.4,
                        ease: 'easeOut',
                      }}
                      style={{ width: `${pct}%` }}
                    />
                    <div className="paste-board-waste" style={{ width: `${100 - pct}%` }} />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { instance } = useMsal()
  const heroRef       = useRef<HTMLDivElement>(null)

  // Let the landing page scroll
  useEffect(() => {
    document.body.style.overflow = 'auto'
    document.body.style.height   = 'auto'
    return () => {
      document.body.style.overflow = ''
      document.body.style.height   = ''
    }
  }, [])

  // Parallax hero scroll-out
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] })
  const heroY       = useTransform(scrollYProgress, [0, 1], ['0%', '18%'])
  const heroOpacity = useTransform(scrollYProgress, [0, 0.65], [1, 0])

  const signIn = () => instance.loginRedirect(loginRequest)

  const cardVariants: Variants = {
    hidden:  { opacity: 0, y: 22, scale: 0.97 },
    visible: { opacity: 1, y: 0,  scale: 1, transition: { duration: 0.42, ease: 'easeOut' } },
  }

  return (
    <div className="landing-root">

      {/* ── Sticky glass nav ─────────────────────────────────────────────── */}
      <motion.nav
        className="landing-nav"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38 }}
      >
        <div className="landing-nav-brand">
          <div className="landing-nav-icon">
            <Hammer size={16} strokeWidth={2.2} />
          </div>
          <span>The Workshop</span>
        </div>
        <button className="landing-nav-cta" onClick={signIn}>
          <Lock size={11} /> Sign in
        </button>
      </motion.nav>

      {/* ── Hero — centered, parallax scroll-out ─────────────────────────── */}
      <motion.section
        className="landing-hero"
        ref={heroRef}
        style={{ y: heroY, opacity: heroOpacity }}
      >
        <div className="landing-hero-copy">
          <motion.p
            className="landing-eyebrow"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4 }}
          >
            <span className="eyebrow-dot" />
            Plan · Build · Curate
          </motion.p>

          <motion.h1
            className="landing-h1"
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
          >
            From rough sketch
            <br />
            <em className="landing-h1-accent">to finished build.</em>
          </motion.h1>

          <motion.p
            className="landing-sub"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.48 }}
          >
            A single-user companion for woodworking. Cut lists, build logs,
            Shaper Hub imports, and an AI that fills in the details — so you
            can spend less time planning and more time building.
          </motion.p>

          <motion.div
            className="landing-cta-wrap"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42, duration: 0.44 }}
          >
            <button className="landing-cta-btn" onClick={signIn}>
              <MsLogo size={17} />
              Sign in with Microsoft
              <ArrowRight size={14} className="cta-arrow" />
            </button>
            <p className="landing-cta-note">Requires a Microsoft account</p>
          </motion.div>
        </div>

        {/* Project cards spread out like folders on a workbench */}
        <HeroCards />
      </motion.section>

      {/* ── Scroll cue ───────────────────────────────────────────────────── */}
      <motion.div
        className="scroll-hint"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 0.5 }}
      >
        <motion.span
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          ↓
        </motion.span>
      </motion.div>

      {/* ── Three pillars: Plan / Build / Curate ─────────────────────────── */}
      <section className="landing-pillars">
        {([
          {
            icon: '📐',
            label: 'Plan',
            headline: 'Cut lists that\ndo the math.',
            body: 'Enter your dimensions and available stock — Workshop generates an optimized cut plan, calculates waste, and tells you exactly how many boards to buy.',
          },
          {
            icon: '🔨',
            label: 'Build',
            headline: 'Log every step,\nforget nothing.',
            body: 'Timestamped build entries with photos and finish records. Your complete project history — what you used, what worked, what to do differently next time.',
          },
          {
            icon: '📖',
            label: 'Curate',
            headline: 'Import projects,\nnot screenshots.',
            body: 'Paste a Shaper Hub link and Workshop extracts the full part list automatically. A connected notebook keeps your ideas and reference material alongside every build.',
          },
        ] as const).map((p, i) => (
          <motion.div
            key={p.label}
            className="pillar-card"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ delay: i * 0.09, duration: 0.48, ease: 'easeOut' }}
          >
            <span className="pillar-icon">{p.icon}</span>
            <span className="pillar-label">{p.label}</span>
            <h3 className="pillar-headline">{p.headline}</h3>
            <p className="pillar-body">{p.body}</p>
          </motion.div>
        ))}
      </section>

      {/* ── URL paste / AI import ─────────────────────────────────────────── */}
      <section className="landing-paste-section">
        <motion.div
          className="paste-section-inner"
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.55 }}
        >
          <div className="paste-copy">
            <span className="paste-pill">✨ AI Import</span>
            <h2 className="paste-h2">
              Drop a link.
              <br />
              Get a <em>cut plan</em>.
            </h2>
            <p className="paste-desc">
              Paste any Shaper Hub project URL. Workshop's AI reads the page,
              extracts every part and dimension, and generates your cut list —
              ready to print and take to the shop.
            </p>
            <ul className="paste-bullets">
              <li><span className="bullet-dot" />Parts, dimensions, and bit info auto-extracted</li>
              <li><span className="bullet-dot" />Cut plan optimized for your available stock</li>
              <li><span className="bullet-dot" />Materials and build-time estimate included</li>
            </ul>
          </div>

          <div className="paste-demo-wrap">
            <UrlPasteDemo />
          </div>
        </motion.div>
      </section>

      {/* ── Supporting features ──────────────────────────────────────────── */}
      <section className="landing-supporting">
        <motion.div
          className="supporting-grid"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
        >
          {SUPPORTING.map((f) => (
            <motion.div key={f.title} className="supporting-card" variants={cardVariants}>
              <span className="supporting-icon">{f.icon}</span>
              <h4 className="supporting-title">{f.title}</h4>
              <p className="supporting-desc">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── Detail strip ─────────────────────────────────────────────────── */}
      <section className="landing-details">
        {([
          { icon: '🔒', title: 'Private by default', desc: 'Microsoft SSO — your existing account, no new password.' },
          { icon: '📱', title: 'Works everywhere',   desc: 'Responsive across phone, tablet, and desktop.' },
          { icon: '⚡', title: 'Instant save',        desc: 'Every change persisted automatically. Nothing slips through.' },
          { icon: '🌙', title: 'Dark mode ready',     desc: "A warm palette that holds up in any light." },
        ] as const).map((item, i) => (
          <motion.div
            key={item.title}
            className="detail-item"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ delay: i * 0.07, duration: 0.4 }}
          >
            <span className="detail-icon">{item.icon}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.desc}</p>
            </div>
          </motion.div>
        ))}
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <section className="landing-bottom-cta">
        <motion.div
          className="bottom-cta-inner"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="bottom-cta-icon">
            <Hammer size={26} strokeWidth={2} />
          </div>
          <h2 className="bottom-cta-h2">Your next project is waiting.</h2>
          <p className="bottom-cta-sub">
            Sign in with your Microsoft account to open your workshop.
          </p>
          <button
            className="landing-cta-btn"
            style={{ fontSize: 15, height: 46, padding: '0 28px' }}
            onClick={signIn}
          >
            <MsLogo size={17} />
            Sign in with Microsoft
            <ArrowRight size={14} className="cta-arrow" />
          </button>
          <p className="landing-cta-note" style={{ textAlign: 'center' }}>
            workshop.enzolopez.net · Personal workspace
          </p>
        </motion.div>
      </section>

    </div>
  )
}
