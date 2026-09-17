import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { getKnowledgeBaseText } from "./googleDoc.js";
import { askWithKnowledgeBase } from "./gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../../public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/chat", async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "Falta el campo 'question'." });
    return;
  }

  try {
    const knowledgeBase = await getKnowledgeBaseText();
    const answer = await askWithKnowledgeBase(question, knowledgeBase);
    res.json({ answer });
  } catch (error) {
    console.error("Error procesando la pregunta:", error);
    res.status(500).json({ error: "No se pudo obtener respuesta. Revisa la configuración del servidor." });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Bot server escuchando en http://localhost:${port}`);
});
