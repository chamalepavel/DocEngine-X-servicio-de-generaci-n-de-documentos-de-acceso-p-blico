import { useState } from "react";
import { generateDocument } from "../services/api";

const HINTS = {
  invoice: ["invoice_number", "date", "company", "client", "items[]", "subtotal", "tax", "total"],
  report: ["title", "author", "date", "area", "summary", "data[]", "conclusions"],
  certificate: ["organization", "recipient", "description", "date", "duration", "signatures[]"],
};

const EXAMPLES = {
  invoice: {
    invoice_number: "FAC-2026-001",
    date: "12/05/2026",
    company: "Soluciones Tech S.A.",
    client: "Juan Perez",
    items: [
      { description: "Diseno web", quantity: 1, price: "1500.00", total: "1500.00" },
      { description: "Hosting anual", quantity: 1, price: "600.00", total: "600.00" },
    ],
    subtotal: "2100.00",
    tax: "252.00",
    total: "2352.00",
    notes: "Gracias por su preferencia.",
  },
  report: {
    title: "Reporte de Ventas Q1 2026",
    author: "Ana Garcia",
    date: "12/05/2026",
    area: "Comercial",
    summary: "Las ventas del Q1 superaron las proyecciones en un 18%.",
    data: [
      { category: "Enero", value: "Q 45,000", notes: "Mes record" },
      { category: "Febrero", value: "Q 38,500", notes: "Normal" },
      { category: "Marzo", value: "Q 52,200", notes: "Campana exitosa" },
    ],
    conclusions: "El equipo supero la meta trimestral gracias a la campana de marzo.",
  },
  certificate: {
    organization: "Universidad Galileo",
    certificate_type: "Participacion",
    recipient: "Carlos Mendoza",
    description: "Por completar satisfactoriamente el curso de Desarrollo Web Avanzado.",
    date: "12 de mayo de 2026",
    duration: "120 horas",
    score: "Excelente",
    signatures: [
      { name: "Dr. Roberto Lima", role: "Rector" },
      { name: "Ing. Maria Torres", role: "Coordinadora Academica" },
    ],
  },
};

const STATUS_MSG = {
  queued: "En cola — se procesara en breve",
  processing: "Generando PDF...",
  completed: "Documento listo",
  failed: "Fallo la generacion",
};

export default function JsonEditor({ onGenerated }) {
  const [templateType, setTemplateType] = useState("invoice");
  const [jsonText, setJsonText] = useState(JSON.stringify(EXAMPLES.invoice, null, 2));
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [jsonError, setJsonError] = useState("");

  function handleTemplateChange(e) {
    const type = e.target.value;
    setTemplateType(type);
    setJsonText(JSON.stringify(EXAMPLES[type], null, 2));
    setStatus(null);
    setFileUrl(null);
    setJsonError("");
  }

  function parseJson() {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonError("");
      return parsed;
    } catch {
      setJsonError("JSON invalido — revisa la sintaxis");
      return null;
    }
  }

  async function handleGenerate() {
    const payload = parseJson();
    if (!payload) return;

    setLoading(true);
    setStatus("queued");
    setFileUrl(null);

    try {
      const data = await generateDocument(templateType, payload);
      onGenerated(data.documentId, setStatus, setFileUrl);
    } catch (err) {
      setStatus("failed");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>Generar documento</h2>

      <div className="form-row">
        <div className="form-group">
          <label>Tipo de plantilla</label>
          <select value={templateType} onChange={handleTemplateChange}>
            <option value="invoice">Factura</option>
            <option value="report">Reporte</option>
            <option value="certificate">Certificado</option>
          </select>
        </div>

        <div className="hints-box">
          <p className="hints-title">Campos esperados</p>
          <ul>
            {HINTS[templateType].map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="form-group">
        <label>Datos JSON</label>
        <textarea
          rows={14}
          value={jsonText}
          onChange={(e) => { setJsonText(e.target.value); setJsonError(""); }}
          spellCheck={false}
          placeholder='{ "campo": "valor" }'
        />
        {jsonError && <p className="json-error">{jsonError}</p>}
      </div>

      <button className="btn-generate" onClick={handleGenerate} disabled={loading}>
        {loading ? "Enviando..." : "Generar PDF"}
      </button>

      {status && (
        <div className={`status-bar status-${status}`}>
          {STATUS_MSG[status]}
          {status === "completed" && fileUrl && (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="btn-download">
              Descargar PDF
            </a>
          )}
        </div>
      )}
    </div>
  );
}
