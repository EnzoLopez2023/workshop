import { useEffect, useRef, useState } from 'react'
import {
  motion,
  useScroll,
  useTransform,
  AnimatePresence,
  type Variants,
} from 'framer-motion'
import { useMsal } from '@azure/msal-react'
import { Hammer, Lock } from 'lucide-react'
import { loginRequest } from './msalConfig'
import '../styles/landing.css'

// ─── Feature data ────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: '📐',
    title: 'Cut List Optimizer',
    desc: 'Generate optimized cut plans from any board dimensions. Minimize waste, maximize yield on every project.',
    color: '#A0522D',
  },
  {
    icon: '🔨',
    title: 'Build Logs',
    desc: 'Timestamped build steps with photos, finish records, and project status — the full story of every build.',
    color: '#7C3E1F',
  },
  {
    icon: '📖',
    title: 'Notebook',
    desc: 'Freeform notes powered by Tabloom — rich block editor, smart tags, and AI-powered search across everything.',
    color: '#6a7fd6',
  },
  {
    icon: '🛒',
    title: 'Shopping List',
    desc: 'Consolidated materials list across all active projects. Mark items off as you walk the lumber yard.',
    color: '#4a9e8f',
  },
  {
    icon: '🔗',
    title: 'Shaper Hub Import',
    desc: 'Paste any Shaper Origin project URL — Workshop extracts every part, dimension, and material automatically.',
    color: '#c08856',
  },
  {
    icon: '✨',
    title: 'AI Analysis',
    desc: 'Claude reads project pages, generates cut lists, estimates build time, and fills in materials — in seconds.',
    color: '#8a6fc7',
  },
]

const TYPEWRITER_LINES = [
  {
    q: 'Analyze shaper.studio/projects/walnut-floating-shelf',
    a: 'Found: Floating Walnut Shelf · 6 parts · Walnut, Cherry · Est. 12h. Cut list generated — 2 boards, ~15% waste.',
  },
  {
    q: "What's my total lumber cost across active projects?",
    a: 'Across 3 active builds: ~$340 hardwood, $85 sheet goods. Walnut shelf is the biggest spend at $220.',
  },
  {
    q: 'Show unfinished steps for the garage bench',
    a: '3 steps remaining: ① Sand to 220 grit  ② Apply second coat Danish oil  ③ Install drawer slides & pulls.',
  },
]

// ─── Microsoft logo ───────────────────────────────────────────────────────────
function MicrosoftLogo({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 21 21" style={{ width: size, height: size, flexShrink: 0 }} aria-hidden>
      <rect x="1"  y="1"  width="9" height="9" rx="0.5" fill="#F25022" />
      <rect x="11" y="1"  width="9" height="9" rx="0.5" fill="#7FBA00" />
      <rect x="1"  y="11" width="9" height="9" rx="0.5" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" rx="0.5" fill="#FFB900" />
    </svg>
  )
}

// ─── Typewriter AI demo ───────────────────────────────────────────────────────
function TypewriterDemo() {
  const [idx, setIdx] = useState(0)
  const [typed, setTyped] = useState('')
  const [phase, setPhase] = useState<'typing' | 'answering' | 'done'>('typing')
  const item = TYPEWRITER_LINES[idx]

  useEffect(() => {
    setTyped('')
    setPhase('typing')
    let i = 0
    const typeInterval = setInterval(() => {
      i++
      setTyped(item.q.slice(0, i))
      if (i >= item.q.length) {
        clearInterval(typeInterval)
        setTimeout(() => setPhase('answering'), 400)
        setTimeout(() => setPhase('done'), 900)
        setTimeout(() => {
          setIdx((prev) => (prev + 1) % TYPEWRITER_LINES.length)
        }, 4200)
      }
    }, 38)
    return () => clearInterval(typeInterval)
  }, [idx, item.q])

  return (
    <div className="ai-demo-window">
      <div className="ai-demo-chrome">
        <span className="ai-demo-dot" />
        <span className="ai-demo-dot" />
        <span className="ai-demo-dot" />
        <span className="ai-demo-label">AI Project Assistant</span>
      </div>
      <div className="ai-demo-body">
        <div className="ai-question-row">
          <span className="ai-avatar">You</span>
          <div className="ai-question-bubble">
            {typed}
            {phase === 'typing' && <span className="ai-cursor-blink" />}
          </div>
        </div>
        <AnimatePresence>
          {phase !== 'typing' && (
            <motion.div
              className="ai-answer-row"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              <span className="ai-avatar ai-avatar-bot">AI</span>
              <div className="ai-answer-bubble">
                {item.a}
                {phase === 'answering' && <span className="ai-cursor-blink" />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="ai-demo-dots">
        {TYPEWRITER_LINES.map((_, i) => (
          <span key={i} className={`ai-dot-pip${i === idx ? ' active' : ''}`} />
        ))}
      </div>
    </div>
  )
}

// ─── Floating workshop mockup ─────────────────────────────────────────────────
function WorkshopMockup() {
  return (
    <motion.div
      className="mockup-wrap"
      animate={{ y: [0, -14, 0] }}
      transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
    >
      <div className="mockup-window">
        {/* Chrome bar */}
        <div className="mockup-chrome">
          <div className="mock-dots">
            <span className="mock-dot mock-dot-r" />
            <span className="mock-dot mock-dot-y" />
            <span className="mock-dot mock-dot-g" />
          </div>
          <span className="mock-url">workshop.enzolopez.net</span>
        </div>

        <div className="mockup-body">
          {/* Sidebar */}
          <div className="mock-sidebar">
            <div className="mock-sb-brand">
              <Hammer size={12} strokeWidth={2.2} />
              <span>Workshop</span>
            </div>
            <div className="mock-nb-item mock-nb-active">
              <span className="mock-nb-dot" style={{ background: '#A0522D' }} />
              🪵 Walnut Shelf
            </div>
            <div className="mock-nb-item">
              <span className="mock-nb-dot" style={{ background: '#7C3E1F' }} />
              🔨 Garage Bench
            </div>
            <div className="mock-nb-item">
              <span className="mock-nb-dot" style={{ background: '#6a7fd6' }} />
              📖 Notebook
            </div>
            <div className="mock-nb-sep" />
            <div className="mock-nb-item mock-nb-muted">🛒 Shopping List</div>
            <div className="mock-nb-item mock-nb-muted">📐 Cut Plans</div>
          </div>

          {/* Page content */}
          <div className="mock-page">
            <div className="mock-page-title">Walnut Floating Shelf</div>
            <div className="mock-tags-row">
              <span className="mock-tag" style={{ background: 'rgba(160,82,45,0.1)', color: '#7C3E1F' }}>
                in progress
              </span>
              <span className="mock-tag" style={{ background: 'rgba(0,0,0,0.05)', color: '#8B7A6B' }}>
                Intermediate
              </span>
            </div>
            <div className="mock-line" style={{ width: '90%' }} />
            <div className="mock-line" style={{ width: '74%' }} />
            <div className="mock-callout-block">
              <span>📐</span>
              <span className="mock-callout-txt">6 parts · 2 boards · ~15% waste</span>
            </div>
            <div className="mock-checklist">
              <span className="mock-check done" />
              <span className="mock-check-txt mock-strike">Mill and dimension stock</span>
            </div>
            <div className="mock-checklist">
              <span className="mock-check done" />
              <span className="mock-check-txt mock-strike">Cut to final length</span>
            </div>
            <div className="mock-checklist">
              <span className="mock-check" />
              <span className="mock-check-txt">Apply Danish oil finish</span>
            </div>
          </div>
        </div>
      </div>

      {/* Floating AI badge */}
      <motion.div
        className="mockup-ai-badge"
        initial={{ opacity: 0, scale: 0.8, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 1.2, duration: 0.5, type: 'spring' }}
      >
        ✨ AI cut list
      </motion.div>

      {/* Floating save badge */}
      <motion.div
        className="mockup-save-badge"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.6, duration: 0.4 }}
      >
        ✓ Saved
      </motion.div>
    </motion.div>
  )
}

// ─── Main landing page ────────────────────────────────────────────────────────
export default function LandingPage() {
  const { instance } = useMsal()
  const heroRef = useRef<HTMLDivElement>(null)

  // Allow page to scroll on the landing
  useEffect(() => {
    document.body.style.overflow = 'auto'
    document.body.style.height = 'auto'
    return () => {
      document.body.style.overflow = ''
      document.body.style.height = ''
    }
  }, [])

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  })
  const heroY = useTransform(scrollYProgress, [0, 1], ['0%', '22%'])
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])

  const signIn = () => instance.loginRedirect(loginRequest)

  const containerVariants: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.09 } },
  }
  const cardVariants: Variants = {
    hidden:   { opacity: 0, y: 32, scale: 0.97 },
    visible:  { opacity: 1, y: 0,  scale: 1,   transition: { duration: 0.5, ease: 'easeOut' } },
  }

  return (
    <div className="landing-root">

      {/* ── Animated background orbs ──────────────────────────────────────── */}
      <div className="landing-orbs" aria-hidden>
        <motion.div
          className="orb orb-1"
          animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="orb orb-2"
          animate={{ x: [0, -22, 0], y: [0, 28, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="orb orb-3"
          animate={{ x: [0, 18, 0], y: [0, -16, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* ── Sticky glass nav ──────────────────────────────────────────────── */}
      <motion.nav
        className="landing-nav"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="landing-nav-brand">
          <Hammer size={18} strokeWidth={2.2} />
          <span>The Workshop</span>
        </div>
        <button className="landing-nav-cta" onClick={signIn}>
          <Lock size={12} /> Sign in
        </button>
      </motion.nav>

      {/* ── Hero — parallax scroll fade ────────────────────────────────────── */}
      <motion.section
        className="landing-hero"
        ref={heroRef}
        style={{ y: heroY, opacity: heroOpacity }}
      >
        <div className="landing-hero-left">
          <motion.div
            className="landing-hero-badge"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.5, type: 'spring' }}
          >
            <span className="hero-badge-dot" />
            Plan · Build · Curate · Every project.
          </motion.div>

          <motion.h1
            className="landing-h1"
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            Your workshop,
            <br />
            <em className="landing-h1-accent">beautifully tracked.</em>
          </motion.h1>

          <motion.p
            className="landing-sub"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.6 }}
          >
            A warm, single-user companion for woodworking. Capture ideas, plan
            cut lists, log every build step, and import projects straight from
            Shaper Hub — all in one place.
          </motion.p>

          <motion.div
            className="landing-ctas"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.48, duration: 0.55 }}
          >
            <button className="landing-cta-btn" onClick={signIn}>
              <MicrosoftLogo size={18} />
              Sign in with Microsoft
              <span className="cta-arrow">→</span>
            </button>
            <p className="landing-cta-note">
              Your private workspace · workshop.enzolopez.net
            </p>
          </motion.div>
        </div>

        {/* Floating workshop mockup */}
        <motion.div
          className="landing-hero-right"
          initial={{ opacity: 0, x: 40, scale: 0.94 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <WorkshopMockup />
        </motion.div>
      </motion.section>

      {/* ── Scroll indicator ──────────────────────────────────────────────── */}
      <motion.div
        className="scroll-hint"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.6, duration: 0.6 }}
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          ↓
        </motion.div>
      </motion.div>

      {/* ── Feature cards ─────────────────────────────────────────────────── */}
      <section className="landing-features">
        <motion.div
          className="section-header"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="section-h2">Everything a woodworker needs.</h2>
          <p className="section-sub">
            From rough sketch to final finish — Workshop keeps every detail of your build organized and accessible.
          </p>
        </motion.div>

        <motion.div
          className="features-grid"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
        >
          {FEATURES.map((f) => (
            <motion.div key={f.title} className="feature-card" variants={cardVariants}>
              <div className="feature-emoji-wrap" style={{ background: `${f.color}18` }}>
                <span className="feature-emoji">{f.icon}</span>
              </div>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-desc">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── AI / Typewriter highlight ─────────────────────────────────────── */}
      <section className="landing-ai-section">
        <motion.div
          className="ai-section-inner"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7 }}
        >
          <div className="ai-section-left">
            <div className="ai-pill">✨ AI-Powered</div>
            <h2 className="ai-section-h2">
              Paste a URL.
              <br />
              Get a <em>complete project</em>.
            </h2>
            <p className="ai-section-p">
              Drop any Shaper Hub or woodworking project link into Workshop.
              Claude reads the page, extracts every part, generates your cut
              list, and estimates build time — in seconds.
            </p>
            <ul className="ai-bullets">
              <li>
                <span className="ai-bullet-dot" />
                Auto-extract parts, dimensions, and materials from project URLs
              </li>
              <li>
                <span className="ai-bullet-dot" />
                AI-optimized cut plans that minimize board waste
              </li>
              <li>
                <span className="ai-bullet-dot" />
                Build time and cost estimates, ready to act on
              </li>
            </ul>
          </div>
          <div className="ai-section-right">
            <TypewriterDemo />
          </div>
        </motion.div>
      </section>

      {/* ── Detail strip ─────────────────────────────────────────────────── */}
      <section className="landing-details">
        {[
          {
            icon: '🔒',
            title: 'Private by default',
            desc: 'Microsoft SSO — your existing account, no new password. Your data stays yours.',
          },
          {
            icon: '📱',
            title: 'Works everywhere',
            desc: 'Responsive on mobile, tablet, and desktop. Same workshop, any screen.',
          },
          {
            icon: '⚡',
            title: 'Instant save',
            desc: 'Every change saved automatically. Never lose a build step or cut measurement.',
          },
          {
            icon: '🌙',
            title: 'Dark mode ready',
            desc: "A warm theme that's easy on the eyes for late-night workshop planning.",
          },
        ].map((item, i) => (
          <motion.div
            key={item.title}
            className="detail-item"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ delay: i * 0.07, duration: 0.5 }}
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
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="bottom-cta-icon">
            <Hammer size={28} strokeWidth={2} />
          </div>
          <h2 className="bottom-cta-h2">Your next project is waiting.</h2>
          <p className="bottom-cta-sub">
            Sign in with your Microsoft account to open your workshop.
          </p>
          <button
            className="landing-cta-btn"
            style={{ fontSize: 15, height: 46, padding: '0 30px' }}
            onClick={signIn}
          >
            <MicrosoftLogo size={18} />
            Sign in with Microsoft
            <span className="cta-arrow">→</span>
          </button>
          <p className="landing-cta-note" style={{ marginTop: 0, textAlign: 'center' }}>
            workshop.enzolopez.net · Personal workspace
          </p>
        </motion.div>
      </section>

    </div>
  )
}
