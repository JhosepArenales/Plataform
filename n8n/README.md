# n8n — flujo Google Doc + Gemini

Este flujo de n8n hace exactamente lo mismo que `server/` (leer el Google Doc
y preguntarle a Gemini), pero sin código, editable visualmente. Con esto,
**el backend Node (`server/`) pasa a ser opcional** — puedes usar uno u otro
como cerebro del bot detrás de Typebot.

```
Typebot (Webhook block) → n8n (Webhook → Google Doc → Gemini → respuesta) → Typebot
```

## 1. Importar el flujo

1. Abrir tu instancia de n8n (self-hosted o n8n Cloud).
2. **Workflows → Import from File** → seleccionar `bot-workflow.json`.

## 2. Configurar credenciales

- Nodo **Get Google Doc**: crear una credencial de tipo *Google API* usando
  la cuenta de servicio (el mismo JSON de la guía en `README.md` de la raíz,
  paso 1) con el scope
  `https://www.googleapis.com/auth/documents.readonly`.
  Recuerda compartir el Google Doc con el email de esa cuenta de servicio.
- Nodo **Ask Gemini**: no usa credencial de n8n, la API key se pasa por la
  variable de entorno `GEMINI_API_KEY` (ver paso 3).

## 3. Variables de entorno de n8n

En la instancia de n8n (archivo `.env` o configuración del contenedor):

```
GOOGLE_DOC_ID=1rTuxoSqSz-TpysSs2w0j5Mx5_Uvpy6ywq_2uOF-rRTo
GEMINI_API_KEY=tu_api_key_de_gemini
```

Si tu instancia de n8n bloquea el acceso a `$env` en expresiones (algunas
configuraciones de n8n Cloud lo restringen), reemplaza `{{$env.GOOGLE_DOC_ID}}`
y `{{$env.GEMINI_API_KEY}}` en los nodos por los valores directos o por
variables definidas en **Settings → Variables**.

## 4. Activar y obtener la URL del webhook

1. Guardar y **activar** el workflow.
2. Copiar la URL del nodo **Webhook** (producción), algo como:
   `https://tu-n8n.dominio.com/webhook/chat`
3. Esa es la URL que va en el bloque de **Webhook** del flujo de Typebot,
   con body `{ "question": "{{pregunta}}" }` (ver `typebot/README.md`).

## Notas

- La lectura del doc es "en vivo": cada pregunta relee el documento
  actual (a diferencia de `server/`, aquí no hay cache de 5 minutos — si el
  doc es grande y el tráfico es alto, conviene agregar un nodo de caché o
  volver a usar `server/`).
- Si luego el doc crece mucho y hace falta una base vectorial (RAG real con
  embeddings), ese es un flujo distinto: se agregaría un vector store
  (ej. Pinecone/Qdrant) entre "Get Google Doc" y "Ask Gemini".
