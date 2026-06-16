import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import JsonEditor from "./components/JsonEditor";
import DocumentHistory from "./components/DocumentHistory";

const socket = io("http://localhost:4000");
let nextId = 0;

export default function App() {
  const [refreshCount, setRefreshCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState([]);
  const listeners = useRef({});

  function toast(msg, type = "info") {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  useEffect(() => {
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("document:status", ({ id, status, file_url, error_reason }) => {
      if (listeners.current[id]) {
        listeners.current[id].setStatus(status);
        if (file_url) listeners.current[id].setFileUrl(file_url);
        if (status === "completed" || status === "failed") {
          setRefreshCount((c) => c + 1);
          delete listeners.current[id];
        }
      }

      if (status === "completed") toast("PDF generado", "success");
      else if (status === "failed") toast(`Error: ${error_reason || "fallo"}`, "error");
      else if (status === "processing") toast("Procesando...", "info");
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("document:status");
    };
  }, []);

  function onGenerated(docId, setStatus, setFileUrl) {
    listeners.current[docId] = { setStatus, setFileUrl };
    setRefreshCount((c) => c + 1);
    toast("Documento en cola", "info");
  }

  return (
    <div className="app">
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span>{t.msg}</span>
            <button onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} className="toast-close">&times;</button>
          </div>
        ))}
      </div>

      <header className="app-header">
        <div className="header-left">
          <h1>Doc<span>Engine</span>-X</h1>
          <p>Generador de documentos PDF en tiempo real</p>
        </div>
        <div className="connection-badge">
          <span className={`dot ${connected ? "dot-on" : "dot-off"}`} />
          <span>{connected ? "Conectado" : "Desconectado"}</span>
        </div>
      </header>

      <main className="main-content">
        <JsonEditor onGenerated={onGenerated} />
        <DocumentHistory refresh={refreshCount} />
      </main>
    </div>
  );
}
