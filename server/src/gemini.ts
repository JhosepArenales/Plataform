import { GoogleGenerativeAI } from "@google/generative-ai";

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY en las variables de entorno.");
  client = new GoogleGenerativeAI(apiKey);
  return client;
}

export async function askWithKnowledgeBase(question: string, knowledgeBase: string): Promise<string> {
  const model = getClient().getGenerativeModel({ model: "gemini-2.0-flash" });

  const systemInstruction = [
    "Eres un asistente que responde preguntas SOLO con base en el siguiente documento.",
    "Si la respuesta no está en el documento, dilo claramente en vez de inventarla.",
    "Responde en español, de forma clara y directa.",
    "",
    "--- DOCUMENTO ---",
    knowledgeBase,
    "--- FIN DEL DOCUMENTO ---",
  ].join("\n");

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: question }] }],
    systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
  });

  return result.response.text();
}
