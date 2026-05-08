import { useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { Hammer } from 'lucide-react'
import { loginRequest } from './msalConfig'

export default function LoginPage() {
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
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: '100dvh',
      backgroundColor: 'var(--color-cream)', alignItems: 'center',
      justifyContent: 'center', padding: '0 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 320, textAlign: 'center' }}>
        <div style={{
          width: 72, height: 72, borderRadius: 18,
          backgroundColor: 'var(--color-ink-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <Hammer size={32} color="var(--color-cream)" strokeWidth={2.2} />
        </div>

        <h1 style={{
          fontFamily: 'var(--font-serif)', fontSize: '2.2rem', fontWeight: 700,
          marginBottom: 8,
        }}>
          The Workshop
        </h1>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', marginBottom: 40, lineHeight: 1.6 }}>
          Sign in with your Microsoft account to access your projects.
        </p>

        <button
          onClick={handleLogin}
          disabled={isSubmitting}
          style={{
            width: '100%', padding: '14px 0',
            backgroundColor: '#fff', color: '#1a1a1a',
            border: '1px solid var(--color-line)', borderRadius: 14,
            fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
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
            marginTop: 16, padding: '10px 14px',
            backgroundColor: '#fef2f2', border: '1px solid #fca5a5',
            borderRadius: 10, color: '#991b1b', fontSize: '0.85rem',
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
