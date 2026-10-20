# Contrato consola ↔ n8n (F2–F3)

La consola nunca habla con HubSpot ni con Metabase. Llama a tres webhooks de n8n a través del proxy del Deployer:

```
navegador → /api/proxy/emi-n8n/webhook/emi/<ruta>  →  https://<n8n>/webhook/emi/<ruta>
```

El proxy agrega la cabecera `X-Emi-Secret: ${N8N_WEBHOOK_SECRET}`, y **cada webhook debe rechazar con 401 cualquier llamada sin ese secreto**. El token de HubSpot y la API key de Metabase se guardan como credenciales de n8n.

Reglas comunes:
- Responder siempre JSON. Si una fuente falla, responder `200 {"error":"upstream_unavailable"}`; Emi dirá que no tiene información suficiente y ofrecerá asesor.
- No devolver el documento completo ni el cuerpo íntegro de los correos.
- Registrar cada llamada en un log de n8n: quién (conversation_id), cuándo, qué fuente, resultado. Sin datos personales en claro.
- Reintentos ante 429/5xx en las llamadas de n8n a HubSpot y Metabase (máx. 3, con backoff).

## 1. `POST /emi/client-lookup`

Request: `{ "documento": "1032416400" }`. Solo dígitos; la consola ya quitó puntos y el dígito de verificación.

Response:
```json
{ "estado": "inversionista | inversionista+contratos_pendientes | mora | prospecto | no_encontrado",
  "nombre": "Laura", "hubspot_id": "123", "ref_masked": "CC ***416400" }
```

Fuente: **Metabase, pregunta 2346 "inversionistas-clientes"** (`POST {metabase}/api/card/2346/query/json` con parámetro de documento, o filtrando en n8n). Reglas de clasificación **pendientes de definir con Plataform**:

| Estado | ¿Qué columna o valor de la consulta 2346 lo indica? |
|---|---|
| inversionista | _por definir_ |
| inversionista+contratos_pendientes | _por definir_ |
| mora | _por definir_ |
| prospecto | _por definir_ |
| no_encontrado | el documento no aparece |

`hubspot_id`: id del contacto en HubSpot (portal 2917670), buscado por email o documento, para asociar el ticket.

## 2. `POST /emi/operation-lookup`

Request: `{ "numero_operacion": "6543", "empresa": "Logística Ficticia" }`. `empresa` es el texto libre del cliente: nombre o NIT.

Response:
```json
{ "found": true, "numero_operacion": "6543", "estado_cobro": "al_dia | prejuridico | juridico",
  "empresa": { "razon_social": "…", "nit": "900333444", "tipo_societario": "SAS" },
  "fecha_pago_estimada": "2026-11-30",
  "ultima_comunicacion": { "fecha": "2026-10-08", "asunto": "…", "resumen": "máx. 300 caracteres" },
  "expediente": { "numero": "…", "tipo_proceso": "…" } }
```
Si no existe o la empresa no coincide: `{ "found": false }`. Nunca revelar el estado en ese caso.

Fuentes:
- Operación, empresa pagadora y estado de cobro: **Metabase, pregunta 3794 "participacion-operaciones-inversionistas"**.
- Última comunicación: correos de HubSpot ("Actualización estado del proceso…", enviados desde info@mesfix.com) asociados a la operación o a la empresa, ordenados por `hs_timestamp` de forma descendente y filtrados por número de operación. Scope requerido: `sales-email-read`.
- Expediente (Baranda Virtual): solo si está guardado en algún sistema. **Sin scraping.**

## 3. `POST /emi/escalate`

Request:
```json
{ "conversation_id": "consola-12", "motivo": "pidio_asesor | reclamo | baja_confianza | cliente_mora | actualizacion_operacion | …",
  "intencion": "pide_asesor", "confianza": 0.21, "fuera_horario": false,
  "cliente": { "estado": "inversionista", "ref": "CC ***416400", "id": "123" },
  "resumen": "Usuario: …\nEmi: …" }
```
Response: `{ "ticket_id": "987654", "status": "created | existing" }`

- **Idempotente:** buscar un ticket abierto con `emi_conversation_id = conversation_id`. Si existe, devolver `existing`; si no, crearlo. La consola tampoco repite la llamada dentro de una misma conversación.
- Pipeline, etapa y propietario o cola: **por definir** en el portal 2917670.
- `fuera_horario = true` → agregar "Contactar el próximo día hábil" al contenido del ticket.
- Asociar el ticket al contacto (`cliente.id`) cuando exista.

## WhatsApp (fase posterior)

`js/engine/engine.js` se puede ejecutar dentro de un nodo Code de n8n. Es un módulo UMD sin dependencias, junto con `menus.js`. El flujo sería:

HubSpot Conversations (WhatsApp) → n8n → `EmiEngine.respond(texto, estado, ctx)`, con FAQs y configuración leídas de la base de la consola → respuesta por el mismo hilo.

El estado de la conversación (`state`) se guarda entre mensajes con el id del hilo.
