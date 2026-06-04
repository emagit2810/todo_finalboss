/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string;
  readonly VITE_SYNC_API_URL?: string;
  readonly VITE_SYNC_AUTH_TOKEN?: string;
  readonly VITE_SYNC_INTERVAL_MS?: string;
  readonly VITE_SYNC_MAX_RETRIES?: string;
  readonly VITE_SYNC_LINEAR_RETRY_MS?: string;
  readonly VITE_SYNC_HTTP_TIMEOUT_MS?: string;
  readonly VITE_NOTE_SYNC_WINDOW_DAYS?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_API_BEARER_TOKEN?: string;
  readonly VITE_PDF_EXPORT_API_URL?: string;
  readonly VITE_PDF_EXPORT_BEARER_TOKEN?: string;
  readonly VITE_FASTAPI_HEALTH_URL?: string;
  readonly VITE_N8N_HEALTH_URL?: string;
  readonly VITE_SERVICE_WAKE_INTERVAL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
