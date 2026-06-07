/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_HEDERA_NETWORK?: string;
  readonly VITE_AGENT_API_PROXY_TARGET?: string;
  readonly VITE_WALLETCONNECT_METADATA_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}