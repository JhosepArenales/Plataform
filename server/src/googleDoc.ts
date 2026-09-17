import { google } from "googleapis";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedText: string | null = null;
let cachedAt = 0;

function extractPlainText(document: any): string {
  const content = document.body?.content ?? [];
  const lines: string[] = [];

  for (const element of content) {
    const paragraph = element.paragraph;
    if (!paragraph?.elements) continue;

    const line = paragraph.elements
      .map((el: any) => el.textRun?.content ?? "")
      .join("");

    if (line.trim().length > 0) lines.push(line.trimEnd());
  }

  return lines.join("\n");
}

export async function getKnowledgeBaseText(): Promise<string> {
  const now = Date.now();
  if (cachedText && now - cachedAt < CACHE_TTL_MS) {
    return cachedText;
  }

  const documentId = process.env.GOOGLE_DOC_ID;
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!documentId) throw new Error("Falta GOOGLE_DOC_ID en las variables de entorno.");
  if (!credentialsJson) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON en las variables de entorno.");

  const credentials = JSON.parse(credentialsJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/documents.readonly"],
  });

  const docs = google.docs({ version: "v1", auth });
  const { data } = await docs.documents.get({ documentId });

  cachedText = extractPlainText(data);
  cachedAt = now;
  return cachedText;
}
