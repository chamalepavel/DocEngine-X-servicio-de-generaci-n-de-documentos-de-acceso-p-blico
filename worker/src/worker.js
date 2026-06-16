require("dotenv").config();
const { Worker } = require("bullmq");
const { Pool } = require("pg");
const Redis = require("ioredis");
const { generatePdf } = require("./generator");
const { saveFile } = require("./storage");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const redisCfg = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT) || 6379,
};

const redisPub = new Redis(redisCfg);

async function emit(id, status, extra = {}) {
  const msg = JSON.stringify({ type: "document:status", data: { id, status, ...extra } });
  await redisPub.publish("document-events", msg);
}

async function updateDb(id, status, extra = {}) {
  const fields = ["status = $2"];
  const vals = [id, status];
  let i = 3;
  if (extra.file_url) { fields.push(`file_url = $${i}`); vals.push(extra.file_url); i++; }
  if (extra.error_reason) { fields.push(`error_reason = $${i}`); vals.push(extra.error_reason); }
  await pool.query(`UPDATE public_documents SET ${fields.join(", ")} WHERE id = $1`, vals);
}

async function processJob(job) {
  const { id, templateType, payload } = job.data;
  console.log(`Procesando ${id} (${templateType})`);

  await updateDb(id, "processing");
  await emit(id, "processing");

  const pdf = await generatePdf(templateType, payload);
  const fileUrl = await saveFile(`${id}.pdf`, pdf);

  await updateDb(id, "completed", { file_url: fileUrl });
  await emit(id, "completed", { file_url: fileUrl });

  console.log(`Completado ${id}`);
  return { id, fileUrl };
}

const worker = new Worker("document-generation", processJob, {
  connection: redisCfg,
  concurrency: 2,
});

worker.on("failed", async (job, err) => {
  if (!job) return;
  const { id } = job.data;
  const reason = err.message || "Error desconocido";
  console.error(`Job fallido ${id}: ${reason}`);
  if (job.attemptsMade >= job.opts.attempts) {
    await updateDb(id, "failed", { error_reason: reason }).catch(() => {});
    await emit(id, "failed", { error_reason: reason }).catch(() => {});
  }
});

worker.on("ready", () => console.log("Worker listo"));
worker.on("error", (err) => console.error("Error en worker:", err.message));

async function shutdown() {
  console.log("Cerrando worker...");
  await worker.close();
  redisPub.disconnect();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
