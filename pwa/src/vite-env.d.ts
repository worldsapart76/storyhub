/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_TOKEN?: string
  readonly VITE_HUB?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.wasm?url' {
  const url: string
  export default url
}
