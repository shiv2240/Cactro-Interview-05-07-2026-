/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GROQ_API_KEY?: string;
  readonly VITE_CONVEX_HTTP_URL?: string;
  readonly VITE_CONVEX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build-time Groq key injected by vite.config.ts — referenced only from SW AI modules. */
declare const __AKA_BUNDLED_GROQ_KEY__: string;
