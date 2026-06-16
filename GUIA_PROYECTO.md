# 🎓 DocEngine-X — Guía completa del proyecto

> Documento de estudio y referencia. Explica la arquitectura, cada componente, el flujo completo y los conceptos clave para poder presentar y defender el proyecto con confianza.

---

## 🏗️ ¿Qué es DocEngine-X?

Es un **servicio de generación de documentos PDF de acceso público**. El usuario escribe datos en formato JSON, elige una plantilla (factura, reporte o certificado), y el sistema genera un PDF descargable — **sin bloquear al usuario mientras se procesa**.

---

## 🧩 Arquitectura: 4 piezas que trabajan juntas

```
┌─────────────┐     HTTP/REST      ┌─────────────┐
│   Frontend  │ ◄─────────────────► │   Backend   │
│  React+Vite │                     │  Express +  │
│  :5173      │ ◄── Socket.IO ────► │  Socket.IO  │
└─────────────┘   (tiempo real)     │   :4000     │
                                    └──────┬──────┘
                                           │ BullMQ (cola)
                                           ▼
                                    ┌─────────────┐
                                    │    Redis    │
                                    │   :6379     │
                                    └──────┬──────┘
                                           │
                                    ┌──────▼──────┐      ┌──────────────┐
                                    │   Worker    │ ────► │  PostgreSQL  │
                                    │  Puppeteer  │      │   :5434      │
                                    └─────────────┘      └──────────────┘
```

**¿Por qué esta arquitectura?**
Generar un PDF con Puppeteer tarda 2-8 segundos. Si lo hicieras directamente en el request HTTP, el usuario esperaría sin respuesta. En cambio, el backend responde **inmediatamente** con un ID, y el worker lo procesa en segundo plano.

---

## 📦 Componente 1: Base de datos — PostgreSQL

**Archivo:** `database/init.sql`

```sql
CREATE TYPE document_status AS ENUM ('queued', 'processing', 'completed', 'failed');
CREATE TYPE template_type   AS ENUM ('invoice', 'report', 'certificate');

CREATE TABLE public_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status        document_status  DEFAULT 'queued',
  template_type template_type    NOT NULL,
  file_url      TEXT,            -- URL del PDF cuando esté listo
  error_reason  TEXT,            -- Por qué falló (si falló)
  created_at    TIMESTAMP        DEFAULT NOW()
);
```

**Conceptos clave:**
- **ENUM** = lista de valores válidos. Si alguien pone `status = 'roto'`, PostgreSQL lo rechaza solo.
- **UUID** = identificador único global generado automáticamente. Más seguro que un ID numérico secuencial (no revela cuántos documentos hay).
- El `status` empieza en `queued` y avanza: `queued → processing → completed` (o `failed`).
- `file_url` y `error_reason` empiezan en `NULL` y se llenan cuando el worker termina.

---

## 📦 Componente 2: Backend — Express + Socket.IO

**Patrón usado: Controller → Service → DB** (3 capas separadas)

### Capa 1: Rutas (`routes/documents.js`)
Solo define los endpoints. Nada de lógica.

```js
router.post("/", generate);      // Crear documento
router.get("/", list);           // Listar historial
router.get("/:id", getOne);      // Ver uno específico
```

### Capa 2: Controlador (`controllers/documentController.js`)
Valida la entrada del usuario. Si algo está mal, responde con error 400.

```js
const VALID_TYPES = ["invoice", "report", "certificate"];

if (!VALID_TYPES.includes(template_type)) {
  return res.status(400).json({ error: "template_type invalido" });
}
// Si todo está bien → llama al servicio
const id = await createDocument(template_type, payload);
res.status(202).json({ documentId: id, status: "queued" });
// 202 = "Aceptado, pero aún no procesado"
```

### Capa 3: Servicio (`services/documentService.js`)
Lógica de negocio: guarda en DB y manda a la cola.

```js
async function createDocument(templateType, payload) {
  // 1. Guarda en PostgreSQL con status 'queued'
  const result = await db.query(
    "INSERT INTO public_documents (template_type) VALUES ($1) RETURNING id",
    [templateType]   // ← parámetro separado, previene SQL Injection
  );
  const id = result.rows[0].id;

  // 2. Manda el trabajo a la cola BullMQ
  await queue.add("generate", { id, templateType, payload });

  return id;
}
```

**¿Por qué separar en capas?**
- El controlador nunca llama directamente a `db.query`.
- El servicio nunca toca `req` ni `res`.
- Cada capa tiene una sola responsabilidad → fácil de mantener y testear.

### Socket.IO en el backend (`index.js`)
El backend está **suscrito a Redis**. Cuando el worker publica un evento, el backend lo reenvía al frontend:

```js
const redisSub = new Redis(redisCfg);
redisSub.subscribe("document-events");
redisSub.on("message", (_ch, msg) => {
  const { type, data } = JSON.parse(msg);
  io.emit(type, data);  // Reenvía a todos los clientes conectados
});
```

### Seguridad incluida:
```js
app.use(helmet());                                 // Cabeceras HTTP seguras automáticamente
app.use(rateLimit({ windowMs: 60000, max: 30 })); // Máx 30 req/min por IP → previene abuso
app.use(cors({ origin: "http://localhost:5173" })); // Solo acepta peticiones del frontend
```

---

## 📦 Componente 3: Worker — El corazón del sistema

### Flujo completo del worker (`worker/src/worker.js`):

```
1. BullMQ le entrega un job con { id, templateType, payload }
2. Actualiza DB: status = 'processing'
3. Publica evento en Redis: { type: "document:status", status: "processing" }
4. generatePdf() → Handlebars + Puppeteer → buffer PDF
5. saveFile() → guarda en /uploads/ (o S3)
6. Actualiza DB: status = 'completed', file_url = '...'
7. Publica evento en Redis: { status: "completed", file_url: "..." }
```

### Generator (`generator.js`) — Cómo se genera el PDF:

```
JSON datos del usuario
        ↓
Handlebars toma la plantilla .hbs y rellena con los datos → HTML
        ↓
Puppeteer abre ese HTML en Chromium (headless/invisible)
        ↓
Puppeteer toma "captura de pantalla" como PDF en formato A4
        ↓
Retorna el buffer binario del PDF
```

**Detalle importante — `try/finally`:**
```js
const browser = await puppeteer.launch({ headless: true });
try {
  // ... genera el PDF
  return pdf;
} finally {
  await browser.close(); // SIEMPRE se cierra, aunque haya error
}
// Sin esto, quedarían procesos de Chromium zombies consumiendo RAM y CPU
```

**Cache de templates en memoria:**
```js
const cache = new Map();

function loadTemplate(type) {
  if (cache.has(type)) return cache.get(type);  // Ya estaba en RAM
  const compiled = Handlebars.compile(fs.readFileSync(file, "utf-8"));
  cache.set(type, compiled);  // Guarda para la próxima vez
  return compiled;
}
// La primera vez lee del disco, las siguientes desde RAM → más rápido
```

### Storage (`storage.js`) — ¿Dónde se guarda el PDF?

```js
const useS3 = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_BUCKET_NAME);

async function saveFile(fileName, pdfBuffer) {
  if (useS3) return await uploadToS3(fileName, pdfBuffer);
  return saveLocally(fileName, pdfBuffer);  // Fallback automático
}
```

- **En desarrollo**: sin credenciales AWS → guarda en `/uploads/` local
- **En producción**: con credenciales → sube a Amazon S3
- El cambio es **automático** con variables de entorno, sin tocar el código

### Reintentos automáticos (BullMQ):
```js
defaultJobOptions: {
  attempts: 3,                                    // Máximo 3 intentos
  backoff: { type: "exponential", delay: 2000 }, // Espera: 2s, 4s, 8s
}
// Si Puppeteer falla por recursos del sistema, lo reintenta automáticamente
```

### Graceful Shutdown:
```js
async function shutdown() {
  await worker.close();  // Espera a que el job actual termine antes de cerrar
  redisPub.disconnect();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);  // Docker usa esta señal al reiniciar contenedores
process.on("SIGINT", shutdown);   // Ctrl+C en la terminal
```

---

## 📦 Componente 4: Frontend — React + Vite

### App.jsx — El cerebro del frontend:

```js
const socket = io("http://localhost:4000");

// Escucha eventos en tiempo real del backend
socket.on("document:status", ({ id, status, file_url, error_reason }) => {
  // Actualiza el estado del documento específico en la UI
  // Muestra notificación toast al usuario
  // Si terminó (completed/failed) → refresca el historial
});
```

**¿Qué es un toast?**
Las notificaciones que aparecen y desaparecen solas después de 5 segundos:
- 🟢 "PDF generado" cuando completa
- 🔴 "Error: ..." cuando falla
- 🔵 "Procesando..." cuando empieza

### Componentes del frontend:
| Componente | ¿Qué hace? |
|---|---|
| **`JsonEditor`** | Formulario donde el usuario escribe el JSON y elige la plantilla |
| **`DocumentHistory`** | Tabla con todos los documentos y sus estados actuales |
| **`StatusBadge`** | Indicador de color del estado (queued/processing/completed/failed) |

### JsonEditor — Detalles de implementación (`JsonEditor.jsx`)

El componente carga **ejemplos reales** por plantilla automáticamente cuando el usuario cambia el tipo:

```js
const EXAMPLES = {
  invoice: {
    invoice_number: "FAC-2026-001",
    company: "Soluciones Tech S.A.",
    client: "Juan Perez",
    items: [
      { description: "Diseno web", quantity: 1, price: "1500.00", total: "1500.00" },
    ],
    subtotal: "2100.00",
    tax: "252.00",
    total: "2352.00",
  },
  report: { title: "Reporte de Ventas Q1 2026", author: "Ana Garcia", ... },
  certificate: { organization: "Universidad Galileo", recipient: "Carlos Mendoza", ... },
};
```

Cuando el usuario cambia la plantilla, el JSON del editor se reemplaza automáticamente con el ejemplo correspondiente — así el usuario siempre tiene un punto de partida funcional.

**Validación en el frontend:** Antes de hacer el POST, el componente intenta hacer `JSON.parse()` del texto escrito. Si el JSON es inválido, muestra un mensaje de error y **no manda la petición**:

```js
function parseJson() {
  try {
    return JSON.parse(jsonText);
  } catch {
    setJsonError("JSON invalido — revisa la sintaxis");
    return null;
  }
}
```

**Barra de estado integrada:** Después de enviar, el componente muestra el estado del documento en tiempo real directamente en el editor (no solo en el historial):
- `queued` → "En cola — se procesara en breve"
- `processing` → "Generando PDF..."
- `completed` → "Documento listo" + botón de descarga
- `failed` → "Fallo la generacion"

### DocumentHistory — Detalles de implementación (`DocumentHistory.jsx`)

Tiene **filtros por estado** (Todos / En cola / Procesando / Completados / Fallidos). Se actualiza automáticamente cuando:
1. El usuario cambia el filtro
2. Cambia la prop `refresh` (que App.jsx incrementa cada vez que un documento termina)

```js
useEffect(() => {
  load();  // Se ejecuta cuando cambia el filtro O cuando llega un evento de Socket.IO
}, [filter, refresh]);
```

La tabla muestra solo los primeros 8 caracteres del UUID para no saturar la vista: `doc.id.slice(0, 8) + "..."`.

### api.js — La capa de servicio del frontend (`services/api.js`)

Abstrae todas las llamadas HTTP del frontend en funciones reutilizables:

```js
const BASE = "http://localhost:4000/api";

// Llama a POST /api/documents
export async function generateDocument(templateType, payload) {
  const res = await fetch(`${BASE}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template_type: templateType, payload }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Error al generar el documento");
  return body;  // { documentId, status: "queued" }
}

// Llama a GET /api/documents o GET /api/documents?status=completed
export async function getDocuments(status) {
  const url = status ? `${BASE}/documents?status=${status}` : `${BASE}/documents`;
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Error al cargar documentos");
  return body.documents;  // Array de documentos
}
```

**Por qué separar en un archivo `api.js`:** Los componentes no deben saber de URLs ni de `fetch`. Si mañana cambia la URL del backend, solo se cambia en un lugar.

---

## 🔄 Flujo completo de una solicitud (de punta a punta)

```
1. Usuario escribe JSON en el frontend y hace clic en "Generar"

2. Frontend → POST /api/documents
   body: { template_type: "invoice", payload: { ... } }

3. Backend valida el input (controlador)
   ✓ template_type es uno de los valores válidos
   ✓ payload es un objeto JSON

4. Backend guarda en PostgreSQL:
   INSERT → id=abc-123, status='queued'

5. Backend agrega job a cola BullMQ en Redis:
   queue.add("generate", { id: "abc-123", templateType: "invoice", payload })

6. Backend responde 202:
   { documentId: "abc-123", status: "queued" }

7. Worker (proceso separado) toma el job de Redis

8. Worker actualiza DB: status = 'processing'
   Worker publica en Redis: { type: "document:status", status: "processing" }

9. Backend reenvía por Socket.IO al frontend
   Frontend muestra toast "Procesando..."

10. Worker: JSON → Handlebars → HTML → Puppeteer → PDF
    Worker guarda PDF en /uploads/abc-123.pdf

11. Worker actualiza DB: status='completed', file_url='http://localhost:4000/uploads/abc-123.pdf'
    Worker publica en Redis: { status: "completed", file_url: "..." }

12. Backend reenvía por Socket.IO al frontend
    Frontend muestra toast "PDF generado ✅"
    Frontend muestra botón de descarga
```

---

## 🐳 Docker Compose — Infraestructura en 1 comando

```yaml
services:
  postgres:
    image: postgres:15-alpine
    ports: ["5434:5432"]       # Puerto externo 5434 : interno 5432
    volumes:
      - ./database/init.sql:/docker-entrypoint-initdb.d/init.sql
      # ↑ Esto ejecuta el SQL automáticamente al crear el contenedor
  redis:
    image: redis:alpine
    ports: ["6379:6379"]
```

```bash
docker-compose up -d   # Levanta Postgres + Redis en segundo plano
docker-compose down -v # Destruye todo, incluyendo los datos
```

**Ventaja:** Nadie necesita instalar PostgreSQL ni Redis en su máquina. Docker los proporciona listos para usar.

---

## 🔑 Las 5 tecnologías más importantes para explicar

| Tecnología | ¿Qué hace en este proyecto? | Documentación oficial |
|---|---|---|
| **BullMQ** | Cola de trabajos sobre Redis. Gestiona los jobs de generación de PDF con reintentos automáticos | https://docs.bullmq.io |
| **Puppeteer** | Controla un Chromium real (headless) para convertir HTML a PDF | https://pptr.dev |
| **Handlebars** | Motor de plantillas. Rellena el HTML con los datos JSON del usuario | https://handlebarsjs.com |
| **Socket.IO** | WebSockets bidireccionales. El frontend recibe actualizaciones sin hacer polling | https://socket.io/docs |
| **Redis Pub/Sub** | Bus de mensajes entre el worker (proceso separado) y el backend | https://redis.io/docs/manual/pubsub |

---

## 💡 Concepto clave: ¿Por qué Redis aparece dos veces?

Redis cumple **dos roles distintos** en este proyecto:

1. **Como broker de BullMQ** → almacena la cola de jobs pendientes (estructura de datos interna de BullMQ)
2. **Como canal Pub/Sub** → medio de comunicación entre el worker y el backend

Son conexiones separadas en el código:
- `connection` dentro de `new Queue(...)` → para BullMQ
- `redisPub` en el worker y `redisSub` en el backend → para Pub/Sub

```
Worker ──── redisPub.publish() ──────► Redis canal "document-events"
                                               │
                                               ▼
Backend ─── redisSub.on("message") ◄──── Redis canal "document-events"
                                               │
                                               ▼
Frontend ◄─────── io.emit() ─────────── Socket.IO
```

---

## ❓ Preguntas frecuentes que te pueden hacer

**¿Por qué el backend responde 202 y no 200?**
> `200 OK` significa "Ya terminé". `202 Accepted` significa "Lo recibí y lo estoy procesando". El PDF no está listo cuando el backend responde, por eso el código correcto es 202.

**¿Qué pasa si el worker falla?**
> BullMQ lo reintenta 3 veces con espera exponencial (2s → 4s → 8s). Si falla las 3 veces, marca el documento como `failed` y notifica al frontend con el motivo del error.

**¿Por qué no guardar el payload en la base de datos?**
> El payload puede ser muy grande y de estructura variable. Se pasa directamente al worker por la cola para procesarlo. La tabla solo guarda el estado y el resultado final (la URL del PDF).

**¿Qué es `networkidle0` en Puppeteer?**
> Es una opción de espera. Le dice a Puppeteer que espere hasta que no haya peticiones de red activas por al menos 500ms. Garantiza que el HTML esté completamente cargado antes de convertirlo a PDF.

**¿Por qué `try/finally` en lugar de solo `try/catch`?**
> `catch` solo se ejecuta si hay un **error**. `finally` se ejecuta **siempre** — con error o sin él. Es esencial para cerrar el browser de Puppeteer en todos los casos. Sin `finally`, un error dejaría procesos de Chromium corriendo indefinidamente.

**¿Por qué concurrencia 2 en el worker?**
> ```js
> const worker = new Worker("document-generation", processJob, { concurrency: 2 });
> ```
> El worker puede procesar 2 PDFs al mismo tiempo. Si se pusiera 1, los jobs se procesan de uno en uno. Si se pusiera 10, el servidor se quedaría sin memoria por todos los procesos de Chromium abiertos.

**¿Qué hace Helmet exactamente?**
> Configura automáticamente cabeceras HTTP de seguridad como:
> - `X-Content-Type-Options: nosniff` → previene MIME sniffing
> - `X-Frame-Options: DENY` → previene clickjacking
> - `Content-Security-Policy` → previene XSS
> - `Strict-Transport-Security` → fuerza HTTPS
> Todo con una sola línea: `app.use(helmet())`

**¿Por qué usar UUID en lugar de un ID numérico (1, 2, 3...)?**
> Un ID numérico secuencial revela información: si tu documento es el #847, sabes que hay al menos 847 documentos. Con UUID (`a3f8c2d1-...`) no se puede deducir nada. Además, los UUID son globalmente únicos aunque se generen en diferentes servidores.

---

## 📋 Resumen de archivos y su responsabilidad

| Archivo | Responsabilidad |
|---|---|
| `docker-compose.yml` | Levanta PostgreSQL y Redis |
| `database/init.sql` | Crea la tabla y los tipos ENUM |
| `backend/src/index.js` | Servidor Express + Socket.IO + suscripción a Redis |
| `backend/src/routes/documents.js` | Define las 3 rutas HTTP |
| `backend/src/controllers/documentController.js` | Valida entrada, responde HTTP |
| `backend/src/services/documentService.js` | Inserta en DB, encola el job |
| `backend/src/db.js` | Pool de conexiones a PostgreSQL |
| `worker/src/worker.js` | Escucha la cola BullMQ, orquesta el proceso |
| `worker/src/generator.js` | Handlebars + Puppeteer → PDF |
| `worker/src/storage.js` | Guarda el PDF (local o S3) |
| `frontend/src/App.jsx` | Socket.IO + layout principal + toasts |
| `frontend/src/components/JsonEditor.jsx` | Formulario de entrada del usuario |
| `frontend/src/components/DocumentHistory.jsx` | Tabla de historial |
| `.env.example` | Documenta todas las variables de entorno necesarias |

---

## 🛡️ Buenas prácticas implementadas (resumen ejecutivo)

| Práctica | Dónde se ve | Por qué importa |
|---|---|---|
| **Controller → Service → DB** | `backend/src/` | Mantenibilidad, cada capa tiene 1 responsabilidad |
| **Validación de entrada** | `documentController.js` | Seguridad, rechaza datos inválidos antes de procesarlos |
| **Cola con reintentos** | `documentService.js` + BullMQ | Resiliencia, los fallos temporales no pierden trabajo |
| **Redis Pub/Sub → Socket.IO** | `index.js` + `worker.js` | UX en tiempo real, sin polling |
| **Helmet + Rate Limiting** | `index.js` | Seguridad HTTP básica en 2 líneas |
| **Cache de templates** | `generator.js` | Performance, evita I/O de disco repetido |
| **try/finally en Puppeteer** | `generator.js` | Estabilidad, el browser siempre se cierra |
| **Graceful Shutdown** | `worker.js` | Los jobs no quedan corruptos al reiniciar |
| **Fallback S3 → local** | `storage.js` | Disponibilidad, funciona sin AWS en desarrollo |
| **`.env.example` versionado** | raíz del proyecto | Seguridad, las credenciales nunca van a Git |
| **Docker Compose** | `docker-compose.yml` | DX, cualquiera levanta el entorno con 1 comando |
| **Queries parametrizadas** | `documentService.js` | Previene SQL Injection |
| **Health check** | `index.js` | Operacional, permite monitoreo del servidor |

---

*Documento generado el 15/06/2026 — DocEngine-X*
