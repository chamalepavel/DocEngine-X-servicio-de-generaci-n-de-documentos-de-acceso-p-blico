# DocEngine-X

Este proyecto lo construí para el curso de Interfaz y Experiencia de Usuario. La idea es simple: el usuario manda datos en JSON, elige qué tipo de documento quiere generar (una factura, un reporte o un certificado), y el sistema le devuelve un PDF listo para descargar, sin que la pantalla se congele ni tenga que esperar cargando.

Lo que me interesaba resolver era exactamente ese problema: generar un PDF tarda varios segundos porque hay que abrir un navegador real, cargar el HTML y convertirlo. Si eso lo hago directo en la petición HTTP, el usuario se queda esperando sin respuesta. Entonces separé el trabajo en dos procesos: el backend recibe la solicitud, la mete a una cola y responde de inmediato con un ID. Un worker independiente toma ese trabajo, genera el PDF y avisa al frontend cuando terminó, todo en tiempo real a través de WebSockets.

El proyecto tiene cuatro partes que trabajan juntas. El frontend está en React con Vite, el backend es Express con Socket.IO, el worker usa BullMQ con Puppeteer y Handlebars, y la base de datos es PostgreSQL. Redis hace dos cosas: guarda la cola de trabajos para BullMQ y sirve como canal de comunicación entre el worker y el backend.

Para levantar el entorno solo se necesita Node.js 18 y Docker Desktop.

Primero hay que levantar la base de datos y Redis:

```bash
docker-compose up -d
```

Eso levanta PostgreSQL en el puerto 5434 y Redis en el 6379. La tabla se crea sola con el script que está en database/init.sql.

Luego hay que correr el backend, el worker y el frontend cada uno en una terminal diferente:

```bash
cd backend
npm run dev
```

```bash
cd worker
npm run dev
```

```bash
cd frontend
npm run dev
```

El backend queda en http://localhost:4000 y el frontend en http://localhost:5173.

Las variables de entorno van en un archivo .env dentro de backend/ y otro dentro de worker/. El archivo .env.example en la raíz del proyecto tiene todos los valores que se necesitan copiar.

La API tiene tres endpoints. Con POST /api/documents se manda el JSON con el tipo de plantilla y los datos, y el sistema responde con el ID del documento y el estado "queued". Con GET /api/documents se consulta el historial completo, y se puede filtrar por estado agregando ?status=completed o cualquier otro estado válido. Con GET /api/documents/:id se consulta un documento específico.

Un ejemplo de lo que se le manda al POST:

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

Los PDFs generados se guardan en una carpeta uploads/ que se crea automáticamente. Si en algún momento se quiere usar S3 en lugar de almacenamiento local, en worker/src/storage.js está toda la lógica lista, solo hay que agregar las credenciales de AWS en el .env y el sistema las detecta solo.
