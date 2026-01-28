interface ImportMetaEnv {
  readonly VITE_BKT_API_ENDPOINT: string
  readonly VITE_BKT_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
