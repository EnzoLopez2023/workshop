import { useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { Hammer, Ruler, Sparkles, BookOpen, ArrowRight } from 'lucide-react'
import { loginRequest } from './msalConfig'

export default function LandingPage() {
  const { instance } = useMsal()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleLogin = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      await instance.loginRedirect(loginRequest)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in right now.')
      setIsSubmitting(false)
    }
  }

  return (
    <main
      className="relative min-h-[100dvh] overflow-hidden"
      style={{ backgroundColor: 'var(--color-cream)', color: 'var(--color-ink)' }}
    >
      {/* Warm gradient blobs — PulseWire's pattern, recolored. Smaller on mobile. */}
      <div aria-hidden className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-32 -left-32 w-72 h-72 md:-top-44 md:-left-44 md:w-[520px] md:h-[520px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(160,82,45,0.18), transparent 70%)',
            filter: 'blur(40px)',
          }}
        />
        <div
          className="absolute -bottom-28 -right-28 w-64 h-64 md:-bottom-40 md:-right-44 md:w-[480px] md:h-[480px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(124,62,31,0.14), transparent 70%)',
            filter: 'blur(40px)',
          }}
        />
      </div>

      {/* ── Sticky header ── */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 md:px-6 md:py-4"
        style={{
          backgroundColor: 'rgba(245, 240, 234, 0.85)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--color-line)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-ink-soft)' }}
          >
            <Hammer className="w-3.5 h-3.5 md:w-4 md:h-4" color="var(--color-cream)" strokeWidth={2.4} />
          </div>
          <span
            className="font-bold text-sm md:text-base tracking-tight"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            The Workshop
          </span>
        </div>
        <button
          onClick={handleLogin}
          disabled={isSubmitting}
          className="rounded-full font-semibold cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 md:px-3.5 md:py-2 text-xs md:text-sm"
          style={{
            border: '1px solid var(--color-rust)',
            backgroundColor: 'transparent',
            color: 'var(--color-rust)',
          }}
        >
          Sign in <ArrowRight className="w-3 h-3 md:w-3.5 md:h-3.5" />
        </button>
      </header>

      <div className="relative z-[1] mx-auto px-4 md:px-6" style={{ maxWidth: 960 }}>
        {/* ── Hero ── */}
        <section
          className="text-center pt-7 pb-4 md:pt-16 md:pb-8"
          style={{ animation: 'fadeUp 0.6s ease-out both' }}
        >
          <p className="eyebrow mb-3 md:mb-4">
            Personal project companion · Plan · Build · Curate
          </p>
          <h1
            className="font-bold leading-[1.1] tracking-tight m-0 text-[2.4rem] md:text-5xl lg:text-6xl"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            From rough sketch
          </h1>
          <h1
            className="font-bold leading-[1.1] tracking-tight m-0 text-[2.4rem] md:text-5xl lg:text-6xl"
            style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-rust)' }}
          >
            to finished build.
          </h1>
          <p
            className="mx-auto mt-3 md:mt-5 max-w-[560px] text-sm md:text-base leading-relaxed"
            style={{ color: 'var(--color-muted)' }}
          >
            A warm, single-user companion for woodworking projects. Capture
            ideas, plan cut lists, log every build step, and import inspiration
            straight from Shaper Hub.
          </p>

          {/* Primary CTA — Cairn-style: sits between subhead and pillar cards */}
          <button
            onClick={handleLogin}
            disabled={isSubmitting}
            className="mt-6 md:mt-8 rounded-[14px] font-bold cursor-pointer inline-flex items-center justify-center gap-3 px-6 py-3 md:px-7 md:py-3.5 text-sm md:text-base"
            style={{
              backgroundColor: '#fff',
              color: '#1a1a1a',
              border: '1px solid var(--color-line)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            {isSubmitting ? (
              <>
                <svg style={{ width: 20, height: 20, animation: 'spin 1s linear infinite' }} viewBox="0 0 24 24" fill="none">
                  <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" />
                </svg>
                Redirecting…
              </>
            ) : (
              <>
                <svg viewBox="0 0 21 21" style={{ width: 20, height: 20, flexShrink: 0 }}>
                  <rect x="1"  y="1"  width="9" height="9" rx="0.5" fill="#F25022" />
                  <rect x="11" y="1"  width="9" height="9" rx="0.5" fill="#7FBA00" />
                  <rect x="1"  y="11" width="9" height="9" rx="0.5" fill="#00A4EF" />
                  <rect x="11" y="11" width="9" height="9" rx="0.5" fill="#FFB900" />
                </svg>
                Sign in with Microsoft
              </>
            )}
          </button>
          <p
            className="mt-2.5 md:mt-3 text-xs md:text-sm"
            style={{ color: 'var(--color-muted)' }}
          >
            Requires a Microsoft account
          </p>

          {error && (
            <div
              className="mt-4 mx-auto max-w-[360px] px-3.5 py-2.5 rounded-[10px] text-sm"
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fca5a5',
                color: '#991b1b',
              }}
            >
              {error}
            </div>
          )}
        </section>

        {/* ── Three pillar cards — horizontal rows on mobile, stacked cards on desktop ── */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3 pb-6 md:pb-12">
          <Pillar
            icon={<Ruler className="w-4 h-4 md:w-5 md:h-5" />}
            title="Plan"
            description="Cut lists, sheet-goods optimizer, materials and cost tracking."
            delay={0.15}
          />
          <Pillar
            icon={<Hammer className="w-4 h-4 md:w-5 md:h-5" />}
            title="Build"
            description="Timestamped build log with photos, finish records, project status."
            delay={0.25}
            accent
          />
          <Pillar
            icon={<BookOpen className="w-4 h-4 md:w-5 md:h-5" />}
            title="Curate"
            description="Shaper Hub imports, freeform notebook, reusable project templates."
            delay={0.35}
          />
        </section>

        {/* ── "A glimpse inside" preview (PulseWire-inspired demo cards) ── */}
        <section
          className="pb-8 md:pb-14"
          style={{ animation: 'fadeUp 0.7s 0.45s ease-out both' }}
        >
          <div className="flex items-center gap-3 mb-3 md:mb-4">
            <p className="eyebrow m-0">A glimpse inside</p>
            <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-line)' }} />
            <Sparkles className="w-3 h-3 md:w-3.5 md:h-3.5" color="var(--color-muted)" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
            <PreviewCard
              title="Walnut wall shelf"
              status="in progress"
              statusColor="var(--color-rust)"
              parts={6}
              hours={12}
              tag="Intermediate"
            />
            <PreviewCard
              title="Garage bench restore"
              status="idea"
              statusColor="var(--color-muted)"
              parts={4}
              hours={8}
              tag="Beginner"
            />
          </div>
          <p
            className="mt-2.5 md:mt-3 text-center italic text-[0.72rem] md:text-[0.78rem]"
            style={{ color: 'var(--color-muted)' }}
          >
            Sample projects. Your workshop is private and lives only in your account.
          </p>
        </section>

        {/* ── Footer — feature recap, button now lives in the hero ── */}
        <footer
          className="text-center py-6 pb-10 md:py-8 md:pb-14"
          style={{
            borderTop: '1px solid var(--color-line)',
            animation: 'fadeUp 0.7s 0.6s ease-out both',
          }}
        >
          <p
            className="text-xs md:text-sm"
            style={{ color: 'var(--color-muted)' }}
          >
            <span className="hidden md:inline">
              Build logs · finish logs · cut plan optimizer · shopping list
              <br />
              Shaper Hub import · AI-assisted analysis · project templates
            </span>
            <span className="md:hidden">
              Build & finish logs · cut plans · shopping list · Shaper Hub · AI
            </span>
          </p>
        </footer>
      </div>
    </main>
  )
}

function Pillar({
  icon, title, description, delay, accent = false,
}: {
  icon: React.ReactNode
  title: string
  description: string
  delay: number
  accent?: boolean
}) {
  return (
    <div
      className="flex flex-row md:flex-col items-center md:items-start gap-3 md:gap-0 p-3 md:p-5 rounded-[14px]"
      style={{
        backgroundColor: accent ? 'rgba(160,82,45,0.06)' : 'var(--color-paper)',
        border: `1px solid ${accent ? 'rgba(160,82,45,0.25)' : 'var(--color-line)'}`,
        animation: `fadeUp 0.6s ${delay}s ease-out both`,
      }}
    >
      <div
        className="flex-shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-[10px] flex items-center justify-center md:mb-3"
        style={{
          backgroundColor: accent ? 'var(--color-rust)' : 'var(--color-cream-2)',
          color: accent ? 'var(--color-cream)' : 'var(--color-ink-soft)',
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h3
          className="m-0 font-bold text-base md:text-xl"
          style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}
        >
          {title}
        </h3>
        <p
          className="m-0 text-[0.78rem] md:text-[0.85rem] leading-snug md:leading-normal mt-0.5 md:mt-1"
          style={{ color: 'var(--color-muted)' }}
        >
          {description}
        </p>
      </div>
    </div>
  )
}

function PreviewCard({
  title, status, statusColor, parts, hours, tag,
}: {
  title: string
  status: string
  statusColor: string
  parts: number
  hours: number
  tag: string
}) {
  return (
    <div
      className="p-3 md:p-4 rounded-[14px]"
      style={{
        backgroundColor: 'var(--color-paper)',
        border: '1px solid var(--color-line)',
      }}
    >
      {/* Mock hero image — stylized woodgrain bar, slim on mobile */}
      <div
        className="h-11 md:h-20 rounded-lg mb-2.5 md:mb-3"
        style={{
          background: 'repeating-linear-gradient(95deg, #C9A27D 0, #B8916C 3px, #C9A27D 6px, #BC9772 9px)',
          opacity: 0.55,
        }}
      />
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="pill"
          style={{
            backgroundColor: statusColor === 'var(--color-rust)' ? 'rgba(160,82,45,0.12)' : 'var(--color-cream-2)',
            color: statusColor,
            textTransform: 'capitalize',
          }}
        >
          {status}
        </span>
        <span className="pill" style={{ backgroundColor: 'var(--color-cream-2)', color: 'var(--color-muted)' }}>
          {tag}
        </span>
      </div>
      <h4
        className="m-0 mb-1.5 md:mb-2 font-bold text-base md:text-[1.05rem]"
        style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}
      >
        {title}
      </h4>
      <div className="flex gap-3 md:gap-4 text-[0.72rem] md:text-[0.78rem]" style={{ color: 'var(--color-muted)' }}>
        <span>{parts} parts</span>
        <span aria-hidden>·</span>
        <span>~{hours}h est.</span>
      </div>
    </div>
  )
}
