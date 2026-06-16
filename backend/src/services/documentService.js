const { Queue } = require("bullmq");
const db = require("../db");

const queue = new Queue("document-generation", {
  connection: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT) || 6379,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

async function createDocument(templateType, payload) {
  const result = await db.query(
    "INSERT INTO public_documents (template_type) VALUES ($1) RETURNING id",
    [templateType]
  );
  const id = result.rows[0].id;

  await queue.add("generate", { id, templateType, payload });

  return id;
}

async function listDocuments(status) {
  const base = "SELECT id, status, template_type, file_url, error_reason, created_at FROM public_documents";
  const rows = status
    ? (await db.query(`${base} WHERE status = $1 ORDER BY created_at DESC LIMIT 50`, [status])).rows
    : (await db.query(`${base} ORDER BY created_at DESC LIMIT 50`)).rows;
  return rows;
}

async function getDocument(id) {
  const result = await db.query(
    "SELECT id, status, template_type, file_url, error_reason, created_at FROM public_documents WHERE id = $1",
    [id]
  );
  return result.rows[0] || null;
}

module.exports = { createDocument, listDocuments, getDocument };
