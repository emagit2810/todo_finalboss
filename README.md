# Gemini Voice Task Master / todo_app

Plantilla y aplicación React + TypeScript + Vite/Tailwind orientada a productividad: lista de tareas, planner con IA, calendario, recordatorios y tracker de gastos, con soporte de voz y TTS.

## Tecnologías principales
- **React 18** (TSX) + **Vite**
- **Tailwind CSS 3** + plugin `tailwindcss-animate`
- **TypeScript** con tipado estricto
- **IndexedDB (idb)** para persistencia local
- **Google GenAI SDK** para TTS/transcripción y generación (Gemini)
- Fetch a API externa (FastAPI) para recordatorios

## Árbol rápido
- `index.html` / `index.tsx` / `App.tsx`
- `components/`
  - `TodoItem.tsx`: tarjeta de tarea con subtareas y acciones.
  - `Sidebar.tsx`: navegación por vistas (list, brainstorm, calendario, medicinas, gastos).
  - `CalendarPanel.tsx`: vista mensual y edición rápida de tareas.
  - `ExpensesPanel.tsx`: alta/edición/borrado de gastos (categoría, frecuencia, monto).
  - `MedicinePanel.tsx`: recordatorios de medicamentos, envía aviso al backend.
  - `LiveVoiceAgent.tsx`: agente de voz (WebAudio + Google GenAI live) para crear/borrar/marcar tareas.
  - `VoiceDictation.tsx`: dictado de voz puntual con transcripción.
  - `Icons.tsx`, `Toast.tsx`: utilitarios UI.
- `services/`
  - `geminiService.ts`: TTS (`speakText`), transcripción (`transcribeAudio`), y brainstorming con Gemini + grounding.
  - `db.ts`: wrapper IndexedDB (stores: todos, deleted_todos, medicines, expenses, ai_planner_results).
  - `reminderService.ts`: POST `/reminder` al backend FastAPI con Bearer token, normaliza prioridad y arma payload.
- `utils/`
  - `audio.ts`: helpers de base64/PCM/WAV y decode de audio buffers.
- `types.ts`: Tipos centrales (`Todo`, `Subtask`, `Medicine`, `Expense`, `Priority`, `ViewMode`, etc.).
- Configuración: `tailwind.config.ts`, `postcss.config.cjs`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `.env.example`.

## Flujo de recordatorios (FastAPI)
- Botón en `App.tsx` (vista tareas) y `MedicinePanel.tsx` llama a `sendReminder`.
- `reminderService` construye body: `{ text, task_id, due_date: null, priority: number|null, type }`.
- Header: `Authorization: Bearer <VITE_API_BEARER_TOKEN>`, URL: `<VITE_API_URL>/reminder` (por defecto `https://fast-api-v.onrender.com`).
- Backend espera `priority` entero; se mapea `P1..P4` ? `1..4`.

## Persistencia local
- IndexedDB via `idb`. Se almacenan tareas, gastos, medicinas y resultados de IA. Borrado "suave" para tareas.

## Voz y IA
- `LiveVoiceAgent` usa Google GenAI live (modelo `gemini-2.5-flash-native-audio-preview-09-2025`) con herramientas para añadir/borrar/marcar tareas.
- `VoiceDictation` usa `transcribeAudio` (Gemini 2.5 flash) para texto.
- `speakText` genera audio TTS (modelo `gemini-2.5-flash-preview-tts`).

## Variables de entorno (front, prefijo VITE_)
Define en `.env` o panel de Render/Azure:
- `VITE_API_URL` : base URL de tu FastAPI (ej. `https://fast-api-v.onrender.com`).
- `VITE_API_BEARER_TOKEN` : debe coincidir exactamente con `API_BEARER_TOKEN` del backend.
- `VITE_API_KEY` (opcional) : si usas el SDK de Google GenAI desde el cliente (según políticas de Google, evita exponer claves sensibles en cliente en producción).

## Variables de entorno (backend FastAPI)
- `API_BEARER_TOKEN` : token que valida /query y /reminder (debe ser el mismo que envía el front).
- `GROQ_API_KEY`, `MODEL_NAME`, `BASE_URL` : para llamadas a Groq.
- `N8N_WEBHOOK_TEST` / `N8N_WEBHOOK_PROD` y `ENVIRONMENT` : integración opcional con n8n.
- `ALLOWED_ORIGINS` : CORS ("*" por defecto).

## Build y deploy
- Local: `npm install` ? `npm run dev` (5173) ? `npm run build` (salida `dist/`).
- Render Static Site / Azure Static Web Apps: Build `npm run build`, publish dir `dist`, Node >=18.17, definir variables VITE_* en el servicio.

## Notas de seguridad
- No dejes `VITE_API_BEARER_TOKEN` vacío; de lo contrario el backend responde 401.
- Evita commit del `.env`; solo `.env.example` con placeholders.
- Si expones el front en producción, considera mover llamadas sensibles (Gemini, Groq) a un backend intermedio para no filtrar claves.

## Detalles de tipado
- `Priority` acepta `'P1' | 'P2' | 'P3' | 'P4'`; en `reminderService` se convierte a número (1..4) antes de enviar al backend.
- `ViewMode` controla las secciones UI (LIST, BRAINSTORM, CALENDAR, MEDICINES, EXPENSES).
- `Expense` incluye `frequency: 'weekly' | 'monthly'`.

## Cómo reproducir el error 422 y la solución
- Causa: enviar `priority: "P3"` (string) al backend que espera int ? 422.
- Solución: mapeo a entero en `reminderService` (implementado).

## Próximos pasos sugeridos
- Añadir validación UX para prioridad y token antes de llamar a `/reminder`.
- Mover claves sensibles a un backend propio si se va a producción pública.
- Agregar tests básicos de integración para `sendReminder` y `db`.
