/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string;
  readonly VITE_FASTAPI_HEALTH_URL?: string;
  readonly VITE_N8N_HEALTH_URL?: string;
  readonly VITE_SERVICE_WAKE_INTERVAL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
