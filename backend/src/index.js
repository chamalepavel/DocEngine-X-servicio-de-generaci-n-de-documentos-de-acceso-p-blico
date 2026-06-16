require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const Redis = require("ioredis");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const documentRoutes = require("./routes/documents");

const app = express();
const server = http.createServer(app);

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 30 }));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(path.join(__dirname, "../../uploads")));
app.use("/api/documents", documentRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(500).json({ error: "Error interno del servidor" });
});

const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || "http://localhost:5173" },
});

const redisCfg = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT) || 6379,
};

const redisSub = new Redis(redisCfg);
redisSub.subscribe("document-events");
redisSub.on("message", (_ch, msg) => {
  try {
    const { type, data } = JSON.parse(msg);
    if (type && data) io.emit(type, data);
  } catch (e) {
    console.error("Error parseando evento:", e.message);
  }
});

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);
  socket.on("disconnect", () => console.log("Cliente desconectado:", socket.id));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Backend en http://localhost:${PORT}`));
