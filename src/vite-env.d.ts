/// <reference types="vite/client" />

declare const __WORKSHOP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_AZURE_CLIENT_ID: string
  readonly VITE_AZURE_AUTHORITY_TENANT_ID: string
  readonly VITE_AZURE_HOME_TENANT_ID: string
  readonly VITE_AZURE_TENANT_ID?: string
  readonly VITE_SHOPKEEP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
