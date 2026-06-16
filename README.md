# DocEngine-X

Sistema de generación de documentos PDF a partir de datos JSON.

---

## Estructura del proyecto

```
Proyecto III/
├── docker-compose.yml      → Levanta Redis y PostgreSQL
├── .env.example            → Variables de entorno de referencia
├── database/
│   └── init.sql            → Crea la tabla public_documents
├── backend/                → API Express + Socket.IO
│   └── src/
│       ├── index.js        → Entrada principal
│       ├── db.js           → Conexión a PostgreSQL
│       ├── routes/         → Rutas HTTP
│       ├── controllers/    → Lógica de cada ruta
│       └── services/       → Interacción con BullMQ y DB
├── worker/                 → Procesador de la cola
│   └── src/
│       ├── worker.js       → Escucha la cola BullMQ
│       ├── generator.js    → Handlebars + Puppeteer → PDF
│       ├── storage.js      → Guarda el PDF (local / S3)
│       └── templates/      → Plantillas .hbs (invoice, report, certificate)
├── frontend/               → Panel React con Vite
│   └── src/
│       ├── App.jsx         → Socket.IO + layout principal
│       ├── components/     → JsonEditor, DocumentHistory, StatusBadge
│       └── services/api.js → Llamadas al backend
└── uploads/                → PDFs generados (creado automáticamente)
```

---

## Requisitos

- Node.js 18+
- Docker Desktop

---

## Paso 1 — Levantar Redis y PostgreSQL

```bash
cd "Proyecto III"
docker-compose up -d
```

Esto levanta:
- **PostgreSQL** en `localhost:5432` (crea la tabla automáticamente)
- **Redis** en `localhost:6379`

---

## Paso 2 — Iniciar el Backend

```bash
cd backend
npm run dev
```

Corre en: `http://localhost:4000`

---

## Paso 3 — Iniciar el Worker

```bash
cd worker
npm run dev
```

El worker escucha la cola y genera PDFs cuando llegan trabajos.

---

## Paso 4 — Iniciar el Frontend

```bash
cd frontend
npm run dev
```

Corre en: `http://localhost:5173`

---

## Flujo completo

```
Usuario escribe JSON + elige plantilla
         ↓
    POST /api/documents
         ↓
  Backend guarda en PostgreSQL (queued)
  Backend manda a cola BullMQ
  Backend responde 202 + documentId
         ↓
    Worker toma el trabajo
    Worker → processing (Socket.IO)
    JSON → Handlebars → HTML → Puppeteer → PDF
    PDF guardado en /uploads/
    Worker → completed + file_url (Socket.IO)
         ↓
  Frontend recibe evento Socket.IO
  Muestra botón de descarga ✅
```

---

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/documents` | Genera un documento |
| GET | `/api/documents` | Lista el historial público |
| GET | `/api/documents?status=failed` | Filtra por estado |

### Ejemplo de body (POST)

```json
{
  "template_type": "invoice",
  "payload": {
    "invoice_number": "FAC-001",
    "date": "12/05/2026",
    "company": "Tech S.A.",
    "client": "Juan Pérez",
    "items": [
      { "description": "Servicio web", "quantity": 1, "price": "1000", "total": "1000" }
    ],
    "subtotal": "1000",
    "tax": "120",
    "total": "1120"
  }
}
```

---

## Variables de entorno

Copiar `.env.example` como `.env` en `/backend` y `/worker`:

```
DB_HOST=localhost
DB_PORT=5432
DB_USER=docengine
DB_PASSWORD=docengine123
DB_NAME=docengine_db
REDIS_HOST=localhost
REDIS_PORT=6379
PORT=4000
BASE_URL=http://localhost:4000
```

---

## Para usar S3 en el futuro

En `worker/src/storage.js`, las líneas comentadas al final de `saveFile()` muestran exactamente cómo conectar S3. Solo se necesita:
1. Instalar `@aws-sdk/client-s3`
2. Descomentar el bloque S3
3. Agregar las credenciales en el `.env`
