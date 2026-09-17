# n8n — Agente de diagnóstico (Google Doc + Gemini)

Flujo tipo **AI Agent** de n8n: el agente decide cuándo consultar el
documento (vía herramienta) en lugar de mandarlo siempre completo en el
prompt. Misma base de conocimiento (el Google Doc), pero con memoria de
conversación y arquitectura de agente.

```
Webhook → Construir prompt → Agente de IA → Procesar respuesta → Respondedor OK
                                  │  │  │
                     Modelo de chat │  Herramienta
                       (Gemini)   Memoria (consulta el Google Doc)
```

## Nodos

- **Webhook**: recibe `POST { "question": "...", "sessionId": "..." }`
  (`sessionId` es opcional, para mantener memoria por conversación).
- **Construir prompt**: normaliza el body del webhook.
- **Agente de IA**: nodo `AI Agent` de n8n (LangChain). Usa el modelo de
  chat, la memoria y la herramienta conectados abajo.
- **Modelo de chat Géminis de Google**: sub-nodo `Google Gemini Chat Model`.
- **Memoria**: `Simple Memory` con ventana de 10 mensajes, por `sessionId`.
- **Herramienta** (`consultar_documento`): `HTTP Request Tool` que llama a
  la Google Docs API. El agente la invoca solo cuando la necesita.
- **Procesar respuesta**: extrae `output` de la respuesta del agente.
- **Respondedor OK**: `Respond to Webhook`, devuelve `{ "answer": "..." }`.

## 1. Importar el flujo

**Workflows → Import from File** → `bot-workflow.json`.

## 2. Configurar credenciales

- **Modelo de chat Géminis de Google**: credencial *Google Gemini(PaLM) Api*
  con tu `GEMINI_API_KEY` (https://aistudio.google.com/app/apikey).
- **Herramienta**: credencial *Google API* con la cuenta de servicio (scope
  `https://www.googleapis.com/auth/documents.readonly`), doc compartido con
  su email — mismos pasos que en el `README.md` de la raíz.

## 3. Variable de entorno

```
GOOGLE_DOC_ID=1rTuxoSqSz-TpysSs2w0j5Mx5_Uvpy6ywq_2uOF-rRTo
```

Si tu instancia bloquea `$env` en expresiones, reemplázalo por el ID directo
en la URL del nodo **Herramienta**.

## 4. Activar y conectar con Typebot

1. Guardar y **activar** el workflow.
2. Copiar la URL de producción del **Webhook** (ej.
   `https://tu-n8n.dominio.com/webhook/diagnostico`).
3. Usarla en el bloque de **Webhook** del flujo de Typebot, con body
   `{ "question": "{{pregunta}}" }`.

## Nota sobre versiones de nodos

Al importar, n8n puede pedir "actualizar" los nodos `AI Agent`, `Google
Gemini Chat Model`, `Simple Memory` o `HTTP Request Tool` a la versión
instalada en tu instancia — es normal, acepta la actualización sugerida por
n8n.
