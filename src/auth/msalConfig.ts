import { LogLevel } from '@azure/msal-browser'

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID
const authorityTenant = import.meta.env.VITE_AZURE_AUTHORITY_TENANT_ID
  || import.meta.env.VITE_AZURE_TENANT_ID

if (!clientId || !authorityTenant) {
  throw new Error(
    'VITE_AZURE_CLIENT_ID and VITE_AZURE_AUTHORITY_TENANT_ID must be set in your .env file. ' +
    'See .env.example for reference.'
  )
}

export const apiScope = `api://${clientId}/access_as_user`

export const msalConfig = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${authorityTenant}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
  system: {
    loggerOptions: {
      loggerCallback(level: number, message: string, containsPii: boolean) {
        if (containsPii) return
        console.debug(`[MSAL:${LogLevel[level]}] ${message}`)
      },
      logLevel: LogLevel.Warning,
    },
  },
}

export const loginRequest = {
  scopes: [apiScope],
}
