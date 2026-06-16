# Buenas Prácticas — DocEngine-X

Documento generado a partir del análisis de dos implementaciones del mismo sistema: el proyecto de Pavel (este repositorio) y el proyecto de Pablo (Pablotechedu/Proyecto-3-DocEngine-X). Se extraen las prácticas más valiosas encontradas en ambos, se explica para qué sirve cada una, cómo se implementó aquí, y cuándo aplicarla en proyectos futuros.

---

## 1. Separación en capas: Controller → Service → DB

**Qué es**
Dividir la lógica de una petición HTTP en tres capas independientes: el controlador recibe la petición y valida la entrada, el servicio ejecuta la lógica de negocio, y la capa de datos habla con la base de datos.

**Cómo se usa en este proyecto**
```
backend/src/controllers/documentController.js  → valida template_type y payload
backend/src/services/documentService.js        → inserta en DB y encola el job
backend/src/db.js                              → Pool de conexiones pg
```

El controlador nunca llama directamente a `db.query`. El servicio nunca toca `req` ni `res`. Cada capa tiene una sola responsabilidad.

**Para qué sirve**
- Cambiar la base de datos sin tocar el controlador.
- Testear la lógica de negocio sin levantar un servidor HTTP.
- Leer el código sin necesidad de rastrear de dónde vienen los datos.

**Cuándo usarlo**
En cualquier backend con más de dos rutas. Desde el primer día del proyecto, no cuando ya está todo mezclado.

---

## 2. Validación manual en el controlador sin librerías externas

**Qué es**
Validar los campos de entrada con condicionales simples en lugar de instalar Zod, Joi, Yup u otras librerías.

**Cómo se usa en este proyecto**
```js
const VALID_TYPES = ["invoice", "report", "certificate"];

if (!template_type || !VALID_TYPES.includes(template_type)) {
  return res.status(400).json({ error: "template_type invalido..." });
}
if (!payload || typeof payload !== "object") {
  return res.status(400).json({ error: "payload debe ser un objeto JSON" });
}
```

**Para qué sirve**
- Menos dependencias instaladas.
- El mensaje de error es exactamente el que quieres, en el idioma que quieres.
- Sin curva de aprendizaje para colaboradores que no conocen la librería.

**Cuándo usarlo**
Cuando los campos a validar son pocos y el esquema no cambia frecuentemente. Si el esquema es muy complejo (más de 10 campos con reglas anidadas), ahí sí conviene Zod.

---

## 3. Cola de trabajos con BullMQ y reintentos con backoff exponencial

**Qué es**
En vez de generar el PDF de forma sincrónica dentro del request HTTP (lo que bloquearía al cliente varios segundos), se encola el job en Redis y un worker independiente lo procesa en segundo plano.

**Cómo se usa en este proyecto**
```js
const queue = new Queue("document-generation", {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});
```

El backend responde inmediatamente con `202 Accepted` y el documentId. El cliente consulta el estado por WebSocket o polling.

**Para qué sirve**
- El servidor no se bloquea mientras Puppeteer genera el PDF (puede tardar 2-8 segundos).
- Si el worker falla, BullMQ lo reintenta automáticamente 3 veces con espera creciente (2s, 4s, 8s).
- Si hay picos de demanda, los jobs se acumulan en la cola y se procesan en orden.

**Cuándo usarlo**
Cualquier operación que tarde más de 500ms: generación de PDFs, envío de emails, procesamiento de imágenes, llamadas a APIs externas lentas, exportaciones de datos grandes.

---

## 4. Comunicación en tiempo real con Redis Pub/Sub → Socket.IO

**Qué es**
El worker publica un evento en un canal de Redis cuando termina un job. El backend está suscrito a ese canal y reenvía el evento al frontend via Socket.IO. Así el usuario ve el cambio de estado sin hacer polling.

**Cómo se usa en este proyecto**
```
Worker                    Redis                    Backend                  Frontend
  |                         |                         |                        |
  |-- PUBLISH doc-events --> |                         |                        |
  |                         |-- message evento ----->  |                        |
  |                         |                         |-- io.emit(type, data)->  |
```

Worker publica:
```js
await redis.publish("document-events", JSON.stringify({ type: "document:completed", data: { id, file_url } }));
```

Backend suscrito:
```js
redisSub.subscribe("document-events");
redisSub.on("message", (_ch, msg) => {
  const { type, data } = JSON.parse(msg);
  io.emit(type, data);
});
```

**Para qué sirve**
- El worker y el backend son procesos separados — no pueden comunicarse directamente.
- Redis actúa como bus de mensajes entre ellos.
- El frontend recibe el update en menos de 100ms después de que el job termina.

**Cuándo usarlo**
Cuando tienes procesos separados (worker, microservicios) que necesitan notificar al cliente de cambios de estado. Alternativa a polling o long-polling.

---

## 5. Seguridad HTTP con Helmet y Rate Limiting

**Qué es**
Helmet configura automáticamente cabeceras HTTP de seguridad. Rate limiting limita cuántas peticiones puede hacer un cliente por ventana de tiempo.

**Cómo se usa en este proyecto**
```js
app.use(helmet());
app.use(rateLimit({ windowMs: 60 * 1000, max: 30 }));
```

Helmet agrega: `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`, entre otras. Rate limit rechaza con `429 Too Many Requests` si el cliente supera 30 peticiones por minuto.

**Para qué sirve**
- Helmet previene ataques XSS, clickjacking, MIME sniffing con cero configuración.
- Rate limit previene abuso de la API, ataques de fuerza bruta, y scraping agresivo.

**Cuándo usarlo**
En todo backend expuesto a internet desde el primer día. Son dos líneas de código con impacto de seguridad alto.

---

## 6. Cache de templates en memoria en el worker

**Qué es**
La primera vez que el worker necesita un template HTML lo lee del disco. Las siguientes veces lo sirve desde un objeto en memoria, evitando I/O repetido.

**Cómo se usa en este proyecto**
```js
const templateCache = {};

async function getTemplate(type) {
  if (!templateCache[type]) {
    const filePath = path.join(__dirname, `../templates/${type}.html`);
    templateCache[type] = await fs.readFile(filePath, "utf8");
  }
  return templateCache[type];
}
```

**Para qué sirve**
- Los templates HTML no cambian en producción. Leerlos del disco en cada job es I/O innecesario.
- Con alta concurrencia, este cache elimina cientos de lecturas de disco por minuto.

**Cuándo usarlo**
Cuando tienes archivos estáticos (templates, configuraciones, traducciones) que se leen frecuentemente y no cambian en runtime. No usar para datos que deben estar actualizados.

---

## 7. try/finally garantizado en recursos costosos (Puppeteer)

**Qué es**
Cuando usas un recurso que debe liberarse (conexión, archivo, browser), el bloque `finally` garantiza que se libera aunque haya error.

**Cómo se usa en este proyecto**
```js
const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const buffer = await page.pdf({ format: "A4", printBackground: true });
  return buffer;
} finally {
  await browser.close();
}
```

**Para qué sirve**
- Sin `finally`, si `page.pdf()` lanza un error, `browser.close()` nunca se ejecuta.
- Los procesos de Chromium quedan zombies consumiendo RAM y CPU.
- Con `finally`, el browser siempre se cierra aunque haya excepción.

**Cuándo usarlo**
Siempre que uses recursos que requieren cierre explícito: conexiones de DB manuales, streams, browsers, archivos abiertos con `open()`.

---

## 8. Graceful Shutdown en el worker

**Qué es**
Cuando el proceso recibe la señal de cierre (SIGTERM en Docker, SIGINT con Ctrl+C), el worker termina el job actual antes de cerrar en lugar de cortarlo a la mitad.

**Cómo se usa en este proyecto**
```js
async function shutdown() {
  await worker.close();
  await redis.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

**Para qué sirve**
- Sin graceful shutdown, si Docker reinicia el contenedor a mitad de un job, el PDF queda corrupto y el documento queda en estado `processing` para siempre.
- Con graceful shutdown, el job termina o falla limpiamente y BullMQ puede reintentarlo.

**Cuándo usarlo**
En cualquier proceso que maneje jobs o transacciones largas. Especialmente importante en entornos Docker/Kubernetes donde los contenedores se reinician frecuentemente.

---

## 9. Fallback automático de almacenamiento: S3 → local

**Qué es**
El worker intenta subir el PDF a S3. Si falla (credenciales no configuradas, sin acceso a internet), guarda el archivo localmente de forma automática sin lanzar error al usuario.

**Cómo se usa en este proyecto**
```js
async function savePDF(buffer, id) {
  if (process.env.AWS_BUCKET) {
    try {
      return await uploadToS3(buffer, id);
    } catch (err) {
      console.error("S3 falló, usando storage local:", err.message);
    }
  }
  return saveLocally(buffer, id);
}
```

**Para qué sirve**
- En desarrollo se trabaja sin S3 sin cambiar código.
- En producción si S3 tiene un problema transitorio, el sistema sigue funcionando.
- El fallback es transparente para el usuario final.

**Cuándo usarlo**
Cuando el servicio externo (S3, CDN, email provider) es importante pero no crítico para la operación básica. No usar en operaciones donde la consistencia es fundamental (pagos, transacciones financieras).

---

## 10. Variables de entorno con .env.example versionado

**Qué es**
El archivo `.env` con valores reales va en `.gitignore` y nunca se sube al repositorio. El archivo `.env.example` documenta todas las variables necesarias con valores de ejemplo y sí se versiona.

**Cómo se usa en este proyecto**
```
.env.example  → versionado en git, valores de ejemplo
.env          → en .gitignore, valores reales
```

`.env.example`:
```env
DB_HOST=localhost
DB_PORT=5434
DB_USER=docengine
DB_PASSWORD=docengine123
DB_NAME=docengine_db
REDIS_HOST=localhost
REDIS_PORT=6379
PORT=4000
BASE_URL=http://localhost:4000
AWS_BUCKET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

**Para qué sirve**
- Un colaborador nuevo clona el repo, copia `.env.example` a `.env`, llena sus valores, y el proyecto funciona.
- Las credenciales reales (contraseñas, API keys) nunca llegan a GitHub.
- Si añades una variable nueva, también la añades al `.env.example` para que todos la tengan.

**Cuándo usarlo**
En absolutamente todo proyecto. Es la práctica más básica y la que más problemas de seguridad previene.

---

## 11. Docker Compose para el entorno de desarrollo local

**Qué es**
Un archivo `docker-compose.yml` levanta todos los servicios de infraestructura (base de datos, cache, message broker) con un solo comando, sin instalar nada más en la máquina del desarrollador.

**Cómo se usa en este proyecto**
```yaml
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: docengine
      POSTGRES_PASSWORD: docengine123
      POSTGRES_DB: docengine_db
      POSTGRES_HOST_AUTH_METHOD: trust
    ports:
      - "5434:5432"

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
```

```bash
docker compose up -d   # levanta Postgres y Redis en background
docker compose down -v # destruye todo incluyendo datos
```

**Para qué sirve**
- Cualquier colaborador puede levantar el entorno con un comando.
- No hay conflictos entre versiones de Postgres instaladas en diferentes máquinas.
- El entorno de desarrollo es idéntico para todo el equipo.

**Cuándo usarlo**
En todo proyecto con base de datos o servicios externos. Si el proyecto necesita más de un servicio, Docker Compose es la solución.

---

## 12. Monorepo con carpetas separadas por responsabilidad

**Qué es**
El proyecto vive en un solo repositorio pero con carpetas claramente separadas: `backend/`, `worker/`, `frontend/`, `database/`. Cada carpeta tiene su propio `package.json` y sus propias dependencias.

**Estructura de este proyecto**
```
Proyecto III/
├── backend/     → API REST + Socket.IO  (Node + Express)
├── worker/      → Procesador de PDFs    (Node + Puppeteer + BullMQ)
├── frontend/    → Interfaz de usuario   (React + Vite)
├── database/    → Migraciones SQL       (init.sql)
└── docker-compose.yml → Infraestructura compartida
```

**Para qué sirve**
- Cada parte puede desplegarse de forma independiente.
- El frontend no tiene acceso accidental a módulos del backend.
- El equipo puede trabajar en paralelo en diferentes partes sin conflictos.
- Es fácil convertirlo en microservicios separados si el proyecto crece.

**Cuándo usarlo**
Cuando el proyecto tiene partes claramente diferenciadas (UI, API, workers). Para proyectos muy pequeños de una sola persona, un monolito es más simple.

---

## 13. Health check endpoint

**Qué es**
Un endpoint `/health` que devuelve el estado del servidor. No hace lógica de negocio — solo confirma que el proceso está vivo.

**Cómo se usa en este proyecto**
```js
app.get("/health", (_req, res) => res.json({ status: "ok" }));
```

**Para qué sirve**
- Load balancers (Nginx, AWS ALB) usan este endpoint para saber si el servidor puede recibir tráfico.
- Kubernetes usa `/health` como liveness probe para reiniciar contenedores caídos.
- Durante debugging permite confirmar que el servidor responde sin depender de la base de datos.

**Cuándo usarlo**
En todo backend que va a correr en un servidor. Es una línea de código con impacto operacional grande.

---

## 14. Manejo de errores global en Express

**Qué es**
Un middleware de 4 parámetros al final de todos los `app.use()` que captura cualquier error no manejado y devuelve una respuesta JSON consistente en lugar de que el servidor se caiga o devuelva HTML de error.

**Cómo se usa en este proyecto**
```js
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(500).json({ error: "Error interno del servidor" });
});
```

**Para qué sirve**
- Sin esto, un error no capturado en una ruta hace que Express devuelva una página HTML con el stack trace visible para el usuario.
- Centraliza el logging de errores en un solo lugar.
- El frontend siempre recibe JSON, nunca HTML inesperado.

**Cuándo usarlo**
En todo backend Express. Va siempre al final de todos los middlewares y rutas.

---

## 15. Queries parametrizadas (prevención de SQL Injection)

**Qué es**
Pasar los valores de usuario como parámetros separados de la query SQL en lugar de concatenarlos como strings.

**Cómo se usa en este proyecto**
```js
await db.query(
  "INSERT INTO public_documents (template_type) VALUES ($1) RETURNING id",
  [templateType]
);

await db.query(
  "SELECT * FROM public_documents WHERE status = $1 ORDER BY created_at DESC",
  [status]
);
```

Nunca:
```js
db.query(`SELECT * FROM public_documents WHERE status = '${status}'`);
```

**Para qué sirve**
- La librería `pg` escapa automáticamente los valores del array.
- Un atacante no puede inyectar SQL a través de los parámetros.
- Es más fácil de leer que la concatenación manual.

**Cuándo usarlo**
Siempre que construyas queries con datos del usuario. Sin excepción.

---

## Resumen rápido

| Práctica | Complejidad de implementar | Impacto |
|---|---|---|
| Controller → Service → DB | Media | Mantenibilidad alta |
| Validación manual de entrada | Baja | Seguridad media |
| BullMQ con reintentos y backoff | Media | Resiliencia alta |
| Redis Pub/Sub → Socket.IO | Media | UX en tiempo real |
| Helmet + Rate Limit | Baja | Seguridad alta |
| Cache de templates en memoria | Baja | Performance media |
| try/finally en recursos costosos | Baja | Estabilidad alta |
| Graceful Shutdown | Baja | Estabilidad alta |
| Fallback S3 → local | Media | Disponibilidad alta |
| .env.example versionado | Baja | Seguridad alta |
| Docker Compose | Baja | DX alta |
| Monorepo por responsabilidad | Baja | Escalabilidad alta |
| Health check endpoint | Baja | Operacional alta |
| Error handler global Express | Baja | Estabilidad alta |
| Queries parametrizadas | Baja | Seguridad alta |

---

## Cuándo aplicar cada grupo en proyectos futuros

**Desde el primer commit de cualquier proyecto:**
- `.env.example` versionado
- Queries parametrizadas
- Docker Compose para la infraestructura
- Health check endpoint
- Error handler global en Express

**Cuando el proyecto tiene al menos 3 rutas:**
- Separación Controller → Service → DB
- Helmet + Rate Limiting
- Validación de entrada en el controlador

**Cuando hay operaciones lentas (más de 500ms):**
- Cola de trabajos con BullMQ
- Redis Pub/Sub para notificaciones en tiempo real
- try/finally en recursos costosos
- Graceful Shutdown

**Cuando el proyecto tiene múltiples partes o un equipo:**
- Estructura Monorepo con carpetas separadas
- Cache de recursos estáticos en memoria
- Fallback entre servicios externos y locales
