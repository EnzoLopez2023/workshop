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
      <main className="auth-loading" aria-live="polite">
        <span className="auth-loading-mark" aria-hidden="true">
          <img src="/apple-touch-icon.png" alt="" width={72} height={72} />
        </span>
        <h1>Signing you in…</h1>
        <p>
          Please wait while we complete authentication.
        </p>
        <span className="auth-loading-line skeleton" aria-hidden="true" />
      </main>
    )
  }

  if (!isAuthenticated) return <LandingPage />

  return <>{children}</>
}
