# Plataform — Bot con base de conocimiento en Google Docs

Bot de chat (widget web) que responde preguntas usando como base de conocimiento
un Google Doc, consultado en vivo, y Gemini como motor de IA.

## Arquitectura

- `server/` — backend en Node.js/TypeScript (Express). Expone `POST /api/chat`.
  - Lee el Google Doc vía Google Docs API (se cachea 5 minutos para no golpear
    la API en cada mensaje, pero siempre refleja ediciones recientes).
  - Envía el texto del doc + la pregunta del usuario a Gemini.
- `public/` — widget de chat embebible propio (`widget.js` + `widget.css`) y
  una página de prueba (`index.html`). Alternativa liviana sin Typebot.
- `typebot/` — Typebot auto-hospedado (interfaz de chat + editor visual de
  flujo, sin código). Su bloque de Webhook puede llamar a `server/` o al
  flujo de `n8n/`. Ver `typebot/README.md`.
- `n8n/` — el mismo flujo (Google Doc + Gemini) pero como workflow de n8n,
  editable sin código y sin depender de `server/`. Ver `n8n/README.md`.

## 1. Generar credenciales de Google (cuenta de servicio)

1. Ir a [Google Cloud Console](https://console.cloud.google.com/) y crear (o
   reusar) un proyecto.
2. Habilitar la **Google Docs API** en ese proyecto.
3. Ir a *IAM y administración → Cuentas de servicio* → crear una cuenta de
   servicio.
4. Generar una clave en formato JSON y descargarla.
5. Abrir el Google Doc, click en **Compartir**, y agregar el email de la
   cuenta de servicio (algo como `nombre@proyecto.iam.gserviceaccount.com`)
   con permiso de **Lector**.

## 2. Configurar variables de entorno

```bash
cd server
cp .env.example .env
```

Completar en `.env`:

- `GEMINI_API_KEY`: obtenida en https://aistudio.google.com/app/apikey
- `GOOGLE_DOC_ID`: ya viene precargado con el ID del doc base
  (`1rTuxoSqSz-TpysSs2w0j5Mx5_Uvpy6ywq_2uOF-rRTo`)
- `GOOGLE_SERVICE_ACCOUNT_JSON`: el contenido completo del JSON descargado en
  el paso 1, pegado **en una sola línea**

**Nunca subir el `.env` ni el JSON de la cuenta de servicio al repositorio.**

## 3. Correr en local

```bash
cd server
npm install
npm run dev
```

Abrir http://localhost:3000 — el widget aparece abajo a la derecha.

## 4. Producción

```bash
cd server
npm install
npm run build
npm start
```

Desplegar en cualquier servicio que corra Node.js (Render, Railway, un VM,
etc.), configurando las mismas variables de entorno.

## Notas de diseño

- La sincronización con el doc es "casi en vivo": se relee cada 5 minutos
  como máximo, no hace falta republicar el bot cuando se edita el documento.
- Si el documento crece mucho (decenas de páginas), este enfoque de "todo el
  texto como contexto" deja de ser eficiente y conviene pasar a una base
  vectorial (embeddings + búsqueda semántica) en vez de mandar el doc completo
  en cada consulta.
