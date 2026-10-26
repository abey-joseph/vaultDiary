/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_READ_ONLY?: string
  readonly VITE_FAKE_DRIVE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
