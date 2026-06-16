import { useState, useEffect } from "react";
import { getDocuments } from "../services/api";

const STATUS_LABELS = {
  queued: "En cola",
  processing: "Procesando",
  completed: "Completado",
  failed: "Fallido",
};

const FILTERS = [
  { label: "Todos", value: "" },
  { label: "En cola", value: "queued" },
  { label: "Procesando", value: "processing" },
  { label: "Completados", value: "completed" },
  { label: "Fallidos", value: "failed" },
];

export default function DocumentHistory({ refresh }) {
  const [docs, setDocs] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    load();
  }, [filter, refresh]);

  async function load() {
    setLoading(true);
    try {
      const data = await getDocuments(filter);
      setDocs(data);
    } catch (err) {
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(str) {
    if (!str) return "-";
    return new Date(str).toLocaleString("es-GT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="card">
      <div className="history-header">
        <h2>Historial publico</h2>
        <button className="btn-refresh" onClick={load} title="Actualizar">&#8635;</button>
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`filter-btn ${filter === f.value ? "active" : ""}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="empty">Cargando...</p>
      ) : docs.length === 0 ? (
        <div className="empty-state">
          <p>No hay documentos en este estado.</p>
          <p className="empty-hint">Genera tu primer PDF usando el editor de arriba.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="history-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th>Error</th>
                <th>Archivo</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td className="cell-id">{doc.id.slice(0, 8)}...</td>
                  <td className="cell-type">{doc.template_type}</td>
                  <td>
                    <span className={`badge badge-${doc.status}`}>
                      {STATUS_LABELS[doc.status] || doc.status}
                    </span>
                  </td>
                  <td className="cell-date">{formatDate(doc.created_at)}</td>
                  <td className="cell-error">
                    {doc.error_reason
                      ? <span className="error-text" title={doc.error_reason}>{doc.error_reason}</span>
                      : <span className="muted">-</span>
                    }
                  </td>
                  <td>
                    {doc.file_url && doc.status === "completed"
                      ? <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="btn-download">Descargar</a>
                      : <span className="muted">-</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
