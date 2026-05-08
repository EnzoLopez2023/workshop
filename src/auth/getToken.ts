import { InteractionRequiredAuthError, type IPublicClientApplication } from '@azure/msal-browser'
import { apiScope } from './msalConfig'

export async function getApiToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0]
  if (!account) throw new Error('No signed-in account')
  try {
    const result = await instance.acquireTokenSilent({ scopes: [apiScope], account })
    return result.accessToken
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await instance.acquireTokenRedirect({ scopes: [apiScope], account })
      // acquireTokenRedirect navigates away; this throw is unreachable in practice
      throw err
    }
    throw err
  }
}
