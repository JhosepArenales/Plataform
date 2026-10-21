# Integración n8n de Emi

Tres flujos listos para importar en `n8n/workflows/`. Se generan con `node n8n/build.js` a partir de `n8n/src/config.js` (configuración) y `n8n/src/lib.js` (lógica). El código de los nodos Code es el mismo que prueban los tests: `tests/n8n.*.test.js` ejecutan el JSON real con Metabase y HubSpot simulados.

| Flujo | Webhook | Fuentes |
|---|---|---|
| `emi-client-lookup.json` | `POST /webhook/emi/client-lookup` | Metabase 2346 → (opcional) contacto de HubSpot por email |
| `emi-operation-lookup.json` | `POST /webhook/emi/operation-lookup` | Metabase 3794 → correos de HubSpot (solo si está en cobro) |
| `emi-escalate.json` | `POST /webhook/emi/escalate` | HubSpot: busca ticket por conversación → lo crea si no existe |

## Puesta en marcha (en este orden)

1. **Secreto del webhook.** Genera uno con `openssl rand -hex 32`. En n8n crea una credencial *Header Auth* llamada `Emi · secreto del webhook`, con nombre de cabecera `X-Emi-Secret` y el secreto como valor. Si la llamada no trae el secreto, n8n responde 403.
2. **Metabase.** Crea una API key en Metabase (Admin → Authentication → API keys) con acceso de lectura a las preguntas 2346 y 3794. En n8n crea una credencial *Header Auth* llamada `Metabase · API key (x-api-key)`, con cabecera `x-api-key`.
3. **HubSpot (portal 2917670).**
   - Crea una Private App con los scopes `crm.objects.contacts.read`, `tickets` y `sales-email-read`.
   - En n8n crea una credencial *HubSpot App Token* llamada `HubSpot · Emi (Private App)`.
   - En HubSpot crea en **Tickets** la propiedad de texto `emi_conversation_id`. Sin ella, el flujo de escalamiento responde `upstream_unavailable`.
4. **Configuración.** Completa los `POR_DEFINIR` de `n8n/src/config.js` y corre `node n8n/build.js`. También puedes editar el nodo *Config* dentro de cada flujo. Faltan:
   - Columnas y reglas de la consulta 2346 (qué columna indica mora, contratos pendientes e inversionista activo).
   - Columnas de la consulta 3794 (número de operación, NIT y razón social de la pagadora, estado de cobro) y sus valores en `mapaEstados`.
   - `ticketPipeline` y `ticketEtapa` del portal 2917670.
   Mientras quede un `POR_DEFINIR`, el flujo responde `not_configured` y Emi ofrece asesor: nunca inventa un estado.
5. **Importar** los 3 JSON (Workflows → Import from file), asignar las credenciales en cada nodo marcado y **activar**.
6. **Probar:** `N8N_URL=https://… EMI_SECRET=… ./n8n/smoke.sh <documento> <operación> <empresa>`
7. **Conectar la consola.** En las credenciales del Deployer (`deploy/credentials.template.json`), poner en `baseUrl` la URL de n8n y en `N8N_WEBHOOK_SECRET` el mismo secreto del paso 1. Esto se hace al publicar, no antes.

## Privacidad

- Los flujos **no guardan ejecuciones exitosas**, porque llevan documentos. Las fallidas sí se guardan para depurar: revisa la retención de ejecuciones de n8n (por ejemplo, 7 días).
- Las respuestas llevan el documento enmascarado. Los resúmenes de correo quitan citas de respuestas anteriores, enmascaran secuencias de 7 o más dígitos y se cortan a 300 caracteres.
- Sin `parametroDocumento` en Metabase, n8n trae la pregunta completa y filtra en memoria. Funciona, pero es menos eficiente y expone más datos dentro de n8n. **Recomendado:** que Álvaro agregue una variable de filtro a las preguntas 2346 y 3794.

---

# Contrato consola ↔ n8n

La consola nunca habla con HubSpot ni con Metabase. Llama a tres webhooks de n8n a través del proxy del Deployer:

```
navegador → /api/proxy/emi-n8n/webhook/emi/<ruta>  →  https://<n8n>/webhook/emi/<ruta>
```

El proxy agrega la cabecera `X-Emi-Secret: ${N8N_WEBHOOK_SECRET}`, y cada webhook rechaza con 403 cualquier llamada sin ese secreto (Header Auth de n8n). El token de HubSpot y la API key de Metabase se guardan como credenciales de n8n.

Reglas comunes:
- Responder siempre JSON. Ante cualquier problema se responde `200 {"error": "upstream_unavailable" | "not_configured" | "bad_request" | "unknown_state"}`; Emi dirá que no tiene información suficiente y ofrecerá asesor.
- No devolver el documento completo ni el cuerpo íntegro de los correos.
- Registrar cada llamada en un log de n8n: quién (conversation_id), cuándo, qué fuente, resultado. Sin datos personales en claro.
- Reintentos en los nodos HTTP: 3 intentos con 1 s de espera.

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
