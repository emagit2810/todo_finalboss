# Gemini Voice Task Master (React + TypeScript + Tailwind + Parcel)

Front-end sin CDN: Tailwind se compila via PostCSS/Parcel, React + TS con IndexedDB y llamadas a Google GenAI.

## Requisitos
- Node.js 18+
- Variables de entorno (build time) en `.env` o configuradas en Render/Azure:
  - `API_KEY` (clave de Google GenAI para TTS y live agent)
  - `VITE_API_URL` (endpoint FastAPI de recordatorios, usado como fallback en el front)
  - `VITE_API_BEARER_TOKEN` (token Bearer para ese endpoint)

## Instalacion
```bash
npm install
```

## Scripts
- `npm run dev` arranca Parcel con HMR.
- `npm run build` genera `dist/` listo para static deploy (`--public-url ./`).
- `npm run typecheck` valida los tipos.

## Configuracion Tailwind
- `tailwind.config.ts` incluye colores `primary`, fuentes `Inter` y plugin `tailwindcss-animate` (para clases `animate-in`, `fade-in`, etc.).
- `postcss.config.cjs` carga `tailwindcss` y `autoprefixer`.
- `styles.css` declara `@tailwind base/components/utilities` sin CDN.

## Estructura rapida
- `index.html` entrada unica sin scripts CDN.
- `index.tsx` monta React y importa `styles.css`.
- `App.tsx` UI completa (tareas, calendario, planner IA, gastos, voz).
- `components/` UI y voz; `services/` Gemini, IndexedDB, recordatorios; `utils/` helpers de audio.
- `.gitignore` excluye `dist/`, `.parcel-cache/`, `node_modules/`, `.env`.

## Deploy (Render static o Azure Static Web Apps)
- Command: `npm run build`
- Publish dir: `dist`
- Node version: `>=18.17`
- Asegura definir `API_KEY`, `VITE_API_URL`, `VITE_API_BEARER_TOKEN` en las variables del servicio.
