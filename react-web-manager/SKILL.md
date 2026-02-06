---
name: react-web-manager
description: Gestión automatizada de páginas web React/TSX con git. Usa este skill cuando el usuario pida crear/modificar páginas React, añadir componentes, actualizar React Router, agregar carousels/cards, gestionar imágenes, añadir botones/links, o hacer commits automáticos explicando cambios. Incluye verificación de sincronización git y validación de errores. Palabras clave - añadir página, crear componente TSX, actualizar router, git push automático, verificar repo, carousel, cards con imágenes.
---

# React Web Manager

Skill para gestión completa de sitios web React/TypeScript con automatización de git.

## Flujo Principal

Siempre seguir este orden:

1. **SYNC CHECK**: Verificar que local y remoto estén sincronizados
2. **ANALYZE**: Revisar estructura actual (routes, components, estilo)
3. **IMPLEMENT**: Hacer cambios solicitados
4. **VALIDATE**: Verificar errores de compilación/sintaxis
5. **GIT AUTO**: Commit y push automático con mensaje descriptivo

## 1. Sync Check

```bash
git fetch origin
git status
# Si hay divergencias: git pull --rebase origin main
```

Si hay conflictos, resolver antes de continuar.

## 2. Analizar Estructura

Localizar archivos clave:
- `src/App.tsx` o `src/main.tsx` (entry point)
- `src/routes/` o routing config
- `src/components/`
- `src/pages/`
- Configuración Tailwind (`tailwind.config.js`)

Identificar patrones de diseño actuales (colores, spacing, componentes).

## 3. Operaciones Comunes

### Crear Nueva Página TSX

```tsx
import { Link } from 'react-router-dom';

export default function NombrePagina() {
  return (
    <div className="min-h-screen p-8">
      <h1 className="text-3xl font-bold">Título</h1>
    </div>
  );
}
```

**Actualizar Router** en el archivo de rutas (ej: `App.tsx`, `routes.tsx`):
```tsx
import NombrePagina from './pages/NombrePagina';

// En <Routes> o router config:
<Route path="/nueva-ruta" element={<NombrePagina />} />
```

### Añadir Links/Botones

```tsx
import { Link } from 'react-router-dom';

<Link to="/ruta" className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
  Ir a Página
</Link>
```

### Carousel con Imágenes

Usar lucide-react para iconos:
```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export default function Carousel({ images }: { images: string[] }) {
  const [current, setCurrent] = useState(0);
  
  return (
    <div className="relative w-full h-96">
      <img src={images[current]} className="w-full h-full object-cover" />
      <button onClick={() => setCurrent((current - 1 + images.length) % images.length)}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-white/80 rounded-full">
        <ChevronLeft />
      </button>
      <button onClick={() => setCurrent((current + 1) % images.length)}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-white/80 rounded-full">
        <ChevronRight />
      </button>
    </div>
  );
}
```

### Cards con Grid

```tsx
export default function CardGrid({ items }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {items.map(item => (
        <div key={item.id} className="p-6 bg-white rounded-lg shadow hover:shadow-lg transition">
          <img src={item.image} className="w-full h-48 object-cover rounded" />
          <h3 className="mt-4 text-xl font-bold">{item.title}</h3>
          <p className="mt-2 text-gray-600">{item.description}</p>
        </div>
      ))}
    </div>
  );
}
```

### Añadir Imágenes al Proyecto

```bash
# Copiar imagen a public/images/
cp /path/to/image.jpg public/images/

# Usar en componente:
<img src="/images/image.jpg" alt="descripción" />
```

## 4. Validación

```bash
npm run build  # o yarn build
# Revisar output para errores
```

Si hay errores TypeScript, corregir antes de commit.

## 5. Git Automation

```bash
git add .
git commit -m "🤖 Claude: [descripción clara del cambio]

- Detalle 1
- Detalle 2

Auto-commit por Claude Web Manager"
git push origin main
```

**Mensaje debe incluir**:
- 🤖 prefix para identificar que fue Claude
- Resumen claro en primera línea
- Lista de cambios específicos

## Reglas de Estilo

- **Tailwind only**: No CSS puro a menos que sea absolutamente necesario
- **Componentes simples**: KISS principle
- **Comentarios mínimos**: Solo lo esencial (máx 2 comentarios cada 4 funciones)
- **Frameworks primero**: Lucide React para iconos, React Router para navegación
- **Responsive**: Siempre mobile-first con Tailwind (`md:`, `lg:`)

## Verificación Final

Checklist antes de push:
- [ ] Sync check completado sin conflictos
- [ ] Build sin errores
- [ ] Rutas actualizadas en router
- [ ] Links funcionan correctamente
- [ ] Diseño responsive
- [ ] Imágenes cargadas
- [ ] Commit message descriptivo

## Troubleshooting

**Conflictos git**: `git pull --rebase origin main` y resolver manualmente
**Errores build**: Revisar imports, tipos TypeScript, sintaxis JSX
**Rutas no funcionan**: Verificar path en router y Link components
**Imágenes no cargan**: Verificar path relativo y que estén en public/