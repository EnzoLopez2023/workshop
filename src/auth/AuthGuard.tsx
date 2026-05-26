import { useEffect } from 'react'
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import { Hammer } from 'lucide-react'
import LandingPage from './LandingPage'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useIsAuthenticated()
  const { instance, inProgress } = useMsal()

  useEffect(() => {
    const accounts = instance.getAllAccounts()
    if (!instance.getActiveAccount() && accounts.length > 0) {
      instance.setActiveAccount(accounts[0])
    }
  }, [instance, isAuthenticated])

  if (
    inProgress === InteractionStatus.HandleRedirect ||
    inProgress === InteractionStatus.AcquireToken
  ) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', minHeight: '100dvh',
        backgroundColor: 'var(--color-cream)', alignItems: 'center',
        justifyContent: 'center', padding: '0 24px',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: 18,
          backgroundColor: 'var(--color-ink-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
        }}>
          <Hammer size={32} color="var(--color-cream)" strokeWidth={2.2} />
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 8 }}>Signing you in…</h1>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>
          Please wait while we complete authentication.
        </p>
      </div>
    )
  }

  if (!isAuthenticated) return <LandingPage />

  return <>{children}</>
}
