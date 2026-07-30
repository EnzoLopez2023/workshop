import { useEffect } from 'react'
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import LandingPage from './LandingPage'
import { isDemoMode } from '../demo/demoMode'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useIsAuthenticated()
  const { instance, inProgress } = useMsal()

  // Demo mode renders the whole app with no MSAL session. The flag is fixed for
  // the session (see demoMode.ts), so hook order stays stable across renders.
  if (isDemoMode()) return <>{children}</>

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
        backgroundColor: 'var(--color-concourse)', alignItems: 'center',
        justifyContent: 'center', padding: '0 24px',
      }}>
        <img
          src="/favicon.svg"
          alt="The Workshop"
          width={72}
          height={72}
          style={{ borderRadius: 3, display: 'block', marginBottom: 20 }}
        />
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
