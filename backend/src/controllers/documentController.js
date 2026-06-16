const { createDocument, listDocuments, getDocument } = require("../services/documentService");

const VALID_TYPES = ["invoice", "report", "certificate"];

async function generate(req, res) {
  const { template_type, payload } = req.body;

  if (!template_type || !VALID_TYPES.includes(template_type)) {
    return res.status(400).json({ error: "template_type invalido. Usa: invoice, report o certificate" });
  }
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "payload debe ser un objeto JSON" });
  }

  try {
    const id = await createDocument(template_type, payload);
    res.status(202).json({ documentId: id, status: "queued" });
  } catch (err) {
    console.error("Error creando documento:", err.message);
    res.status(500).json({ error: "No se pudo crear el documento" });
  }
}

async function list(req, res) {
  const { status } = req.query;
  const allowed = ["queued", "processing", "completed", "failed"];

  if (status && !allowed.includes(status)) {
    return res.status(400).json({ error: "status invalido" });
  }

  try {
    const documents = await listDocuments(status);
    res.json({ documents });
  } catch (err) {
    console.error("Error listando documentos:", err.message);
    res.status(500).json({ error: "No se pudo obtener el historial" });
  }
}

async function getOne(req, res) {
  try {
    const doc = await getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    res.json(doc);
  } catch (err) {
    console.error("Error obteniendo documento:", err.message);
    res.status(500).json({ error: "No se pudo obtener el documento" });
  }
}

module.exports = { generate, list, getOne };
