const BASE = "http://localhost:4000/api";

export async function generateDocument(templateType, payload) {
  const res = await fetch(`${BASE}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template_type: templateType, payload }),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Error al generar el documento");
  return body;
}

export async function getDocuments(status) {
  const url = status ? `${BASE}/documents?status=${status}` : `${BASE}/documents`;
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Error al cargar documentos");
  return body.documents;
}
