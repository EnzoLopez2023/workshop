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
      style={{
        position: 'relative',
        minHeight: '100dvh',
        backgroundColor: 'var(--color-cream)',
        color: 'var(--color-ink)',
        overflow: 'hidden',
      }}
    >
      {/* Warm gradient blobs — PulseWire's pattern, recolored */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -180, left: -180,
          width: 520, height: 520, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(160,82,45,0.18), transparent 70%)',
          filter: 'blur(40px)',
        }} />
        <div style={{
          position: 'absolute', bottom: -160, right: -180,
          width: 480, height: 480, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,62,31,0.14), transparent 70%)',
          filter: 'blur(40px)',
        }} />
      </div>

      {/* ── Sticky header ── */}
      <header
        style={{
          position: 'sticky', top: 0, zIndex: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 24px',
          backgroundColor: 'rgba(245, 240, 234, 0.85)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--color-line)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            backgroundColor: 'var(--color-ink-soft)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Hammer size={16} color="var(--color-cream)" strokeWidth={2.4} />
          </div>
          <span style={{
            fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '1.05rem',
            letterSpacing: '-0.01em',
          }}>
            The Workshop
          </span>
        </div>
        <button
          onClick={handleLogin}
          disabled={isSubmitting}
          style={{
            padding: '8px 14px', borderRadius: 999,
            border: '1px solid var(--color-rust)', backgroundColor: 'transparent',
            color: 'var(--color-rust)', fontSize: '0.82rem', fontWeight: 600,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          Sign in <ArrowRight size={14} />
        </button>
      </header>

      <div style={{
        position: 'relative', zIndex: 1,
        maxWidth: 960, margin: '0 auto', padding: '0 24px',
      }}>
        {/* ── Hero ── */}
        <section
          style={{
            textAlign: 'center',
            padding: '64px 0 32px',
            animation: 'fadeUp 0.6s ease-out both',
          }}
        >
          <p className="eyebrow" style={{ marginBottom: 16 }}>
            Personal project companion · Plan · Build · Curate
          </p>
          <h1 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(2.2rem, 5vw, 3.6rem)',
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: 0,
          }}>
            From rough sketch
          </h1>
          <h1 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(2.2rem, 5vw, 3.6rem)',
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            color: 'var(--color-rust)',
            margin: 0,
          }}>
            to finished build.
          </h1>
          <p style={{
            maxWidth: 560, margin: '20px auto 0',
            color: 'var(--color-muted)', fontSize: '1rem', lineHeight: 1.6,
          }}>
            A warm, single-user companion for woodworking projects. Capture
            ideas, plan cut lists, log every build step, and import inspiration
            straight from Shaper Hub.
          </p>
        </section>

        {/* ── Three pillar cards (Cairn-inspired stat row) ── */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            paddingBottom: 48,
          }}
        >
          <Pillar
            icon={<Ruler size={20} />}
            title="Plan"
            description="Cut lists, sheet-goods optimizer, materials and cost tracking."
            delay={0.15}
          />
          <Pillar
            icon={<Hammer size={20} />}
            title="Build"
            description="Timestamped build log with photos, finish records, project status."
            delay={0.25}
            accent
          />
          <Pillar
            icon={<BookOpen size={20} />}
            title="Curate"
            description="Shaper Hub imports, freeform notebook, reusable project templates."
            delay={0.35}
          />
        </section>

        {/* ── "A glimpse inside" preview (PulseWire-inspired demo cards) ── */}
        <section style={{ paddingBottom: 56, animation: 'fadeUp 0.7s 0.45s ease-out both' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            marginBottom: 16,
          }}>
            <p className="eyebrow" style={{ margin: 0 }}>A glimpse inside</p>
            <div style={{ flex: 1, height: 1, backgroundColor: 'var(--color-line)' }} />
            <Sparkles size={14} color="var(--color-muted)" />
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12,
          }}>
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
          <p style={{
            marginTop: 12, fontSize: '0.78rem', color: 'var(--color-muted)',
            textAlign: 'center', fontStyle: 'italic',
          }}>
            Sample projects. Your workshop is private and lives only in your account.
          </p>
        </section>

        {/* ── Footer CTA ── */}
        <footer
          style={{
            borderTop: '1px solid var(--color-line)',
            padding: '40px 0 56px', textAlign: 'center',
            animation: 'fadeUp 0.7s 0.6s ease-out both',
          }}
        >
          <p style={{ color: 'var(--color-muted)', fontSize: '0.88rem', marginBottom: 24 }}>
            Build logs · finish logs · cut plan optimizer · shopping list
            <br />
            Shaper Hub import · AI-assisted analysis · project templates
          </p>
          <button
            onClick={handleLogin}
            disabled={isSubmitting}
            style={{
              padding: '14px 28px', borderRadius: 14,
              backgroundColor: '#fff', color: '#1a1a1a',
              border: '1px solid var(--color-line)',
              fontSize: '0.95rem', fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 12,
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

          {error && (
            <div style={{
              marginTop: 16, padding: '10px 14px', maxWidth: 360,
              marginLeft: 'auto', marginRight: 'auto',
              backgroundColor: '#fef2f2', border: '1px solid #fca5a5',
              borderRadius: 10, color: '#991b1b', fontSize: '0.85rem',
            }}>
              {error}
            </div>
          )}
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
      style={{
        padding: '20px',
        borderRadius: 14,
        backgroundColor: accent ? 'rgba(160,82,45,0.06)' : 'var(--color-paper)',
        border: `1px solid ${accent ? 'rgba(160,82,45,0.25)' : 'var(--color-line)'}`,
        animation: `fadeUp 0.6s ${delay}s ease-out both`,
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        backgroundColor: accent ? 'var(--color-rust)' : 'var(--color-cream-2)',
        color: accent ? 'var(--color-cream)' : 'var(--color-ink-soft)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 12,
      }}>
        {icon}
      </div>
      <h3 style={{
        fontFamily: 'var(--font-serif)', fontSize: '1.2rem', fontWeight: 700,
        margin: '0 0 4px', color: 'var(--color-ink)',
      }}>
        {title}
      </h3>
      <p style={{
        margin: 0, color: 'var(--color-muted)', fontSize: '0.85rem', lineHeight: 1.5,
      }}>
        {description}
      </p>
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
      style={{
        padding: '16px',
        borderRadius: 14,
        backgroundColor: 'var(--color-paper)',
        border: '1px solid var(--color-line)',
      }}
    >
      {/* Mock hero image — stylized woodgrain bar */}
      <div style={{
        height: 80, borderRadius: 8, marginBottom: 12,
        background: 'repeating-linear-gradient(95deg, #C9A27D 0, #B8916C 3px, #C9A27D 6px, #BC9772 9px)',
        opacity: 0.55,
      }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
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
      <h4 style={{
        fontFamily: 'var(--font-serif)', fontSize: '1.05rem', fontWeight: 700,
        margin: '0 0 8px', color: 'var(--color-ink)',
      }}>
        {title}
      </h4>
      <div style={{ display: 'flex', gap: 16, fontSize: '0.78rem', color: 'var(--color-muted)' }}>
        <span>{parts} parts</span>
        <span aria-hidden>·</span>
        <span>~{hours}h est.</span>
      </div>
    </div>
  )
}
