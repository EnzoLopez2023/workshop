import { useEffect, useReducer, useState } from 'react'
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { ChevronRight } from 'lucide-react'
import {
  InteractionStatus,
  type AccountInfo,
  type IPublicClientApplication,
} from '@azure/msal-browser'
import LandingPage from './LandingPage'
import { getMicrosoftAccountType, getWebAccountSummary } from './accountIdentity'
import { loginRequest } from './msalConfig'
import { isDemoMode } from '../demo/demoMode'

function SigningIn() {
  return (
    <main className="auth-loading" aria-live="polite">
      <span className="auth-loading-mark" aria-hidden="true">
        <img src="/apple-touch-icon.png" alt="" width={72} height={72} />
      </span>
      <h1>Signing you in…</h1>
      <p>Please wait while we complete authentication.</p>
      <span className="auth-loading-line skeleton" aria-hidden="true" />
    </main>
  )
}

function accountInitials(account: AccountInfo) {
  const summary = getWebAccountSummary(account)
  return summary.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'M'
}

function AccountPicker({
  accounts,
  instance,
  onSelect,
}: {
  accounts: AccountInfo[]
  instance: IPublicClientApplication
  onSelect: (account: AccountInfo) => void
}) {
  const [openingMicrosoft, setOpeningMicrosoft] = useState(false)
  const [authError, setAuthError] = useState('')

  const useAnotherAccount = async () => {
    if (openingMicrosoft) return
    setOpeningMicrosoft(true)
    setAuthError('')
    try {
      await instance.loginRedirect(loginRequest)
    } catch (error) {
      console.error('Microsoft account selection failed', error)
      setOpeningMicrosoft(false)
      setAuthError('Microsoft account selection could not open. Check the connection and try again.')
    }
  }

  return (
    <main className="auth-loading auth-account-picker">
      <span className="auth-loading-mark" aria-hidden="true">
        <img src="/apple-touch-icon.png" alt="" width={72} height={72} />
      </span>
      <h1>Choose your Workshop account</h1>
      <p>
        Choose the Microsoft identity that already has your projects. Each identity
        opens a separate private workspace, even when two accounts show the same email address.
      </p>
      <div className="auth-account-list" aria-label="Microsoft accounts saved in this browser">
        {accounts.map(account => {
          const summary = getWebAccountSummary(account)
          return (
            <button
              className="auth-account-option"
              key={account.homeAccountId}
              type="button"
              onClick={() => onSelect(account)}
            >
              <span className="auth-account-avatar" aria-hidden="true">{accountInitials(account)}</span>
              <span className="auth-account-option-copy">
                <strong>{summary.displayName}</strong>
                {summary.secondaryLabel && <span>{summary.secondaryLabel}</span>}
                <small>{getMicrosoftAccountType(account)}</small>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          )
        })}
      </div>
      <button
        className="btn btn-primary"
        type="button"
        onClick={() => void useAnotherAccount()}
        disabled={openingMicrosoft}
      >
        {openingMicrosoft ? 'Opening Microsoft…' : 'Use another Microsoft account'}
      </button>
      {authError && <p className="auth-account-error" role="alert">{authError}</p>}
    </main>
  )
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useIsAuthenticated()
  const { instance, accounts, inProgress } = useMsal()
  const [, refreshActiveAccount] = useReducer(value => value + 1, 0)
  const activeAccount = instance.getActiveAccount()

  // Demo mode renders the whole app with no MSAL session. The flag is fixed for
  // the session (see demoMode.ts), so hook order stays stable across renders.
  if (isDemoMode()) return <>{children}</>

  useEffect(() => {
    if (
      inProgress === InteractionStatus.None
      && !activeAccount
      && accounts.length === 1
    ) {
      instance.setActiveAccount(accounts[0])
      refreshActiveAccount()
    }
  }, [accounts, activeAccount, inProgress, instance])

  if (inProgress !== InteractionStatus.None) return <SigningIn />

  if (!isAuthenticated) return <LandingPage />

  if (!activeAccount && accounts.length === 1) return <SigningIn />

  if (!activeAccount) {
    return (
      <AccountPicker
        accounts={accounts}
        instance={instance}
        onSelect={account => {
          instance.setActiveAccount(account)
          refreshActiveAccount()
        }}
      />
    )
  }

  return <>{children}</>
}
