import { InteractionRequiredAuthError, type IPublicClientApplication } from '@azure/msal-browser'

const TABLOOM_CLIENT_ID = import.meta.env.VITE_TABLOOM_CLIENT_ID

if (!TABLOOM_CLIENT_ID) {
  throw new Error(
    'VITE_TABLOOM_CLIENT_ID must be set in your .env file. ' +
    'See .env.example for reference.'
  )
}

export const tabloomApiScope = `api://${TABLOOM_CLIENT_ID}/access_as_user`

export async function getTabloomToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0]
  if (!account) throw new Error('No signed-in account')
  try {
    const result = await instance.acquireTokenSilent({ scopes: [tabloomApiScope], account })
    return result.accessToken
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await instance.acquireTokenRedirect({ scopes: [tabloomApiScope], account })
      // acquireTokenRedirect navigates away; this throw is unreachable in practice
      throw err
    }
    throw err
  }
}
