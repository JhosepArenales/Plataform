# Consola de Emi — Fase 0: plan, descubrimiento y supuestos

Fecha: 2026-10-20 · Estado: **pendiente de aprobación**

Este documento cierra la F0. Separa lo que se verificó (HECHO) de lo que se infiere o se supone, y lista las decisiones que hacen falta para pasar a F1.

---

## 1. Conclusión ejecutiva

1. **Hoy HubSpot no tiene los datos que Emi necesita.** El portal conectado (ID 51892044) no tiene propiedad de documento (CC/NIT) en contactos ni en empresas, no tiene número de operación, no tiene objetos personalizados y solo contiene 1 deal de ejemplo y 27 contactos. Antes de integrar hay que decidir **de dónde salen los datos de cliente y de operación** (sección 4).
2. **El Plataform Deployer no aloja un backend propio.** Publica un frontend con un servidor Express generado que ofrece: CRUD automático sobre MySQL (`/api/db/<tabla>`), un proxy de APIs externas con secretos del lado servidor (`/api/proxy/<nombre>/...`) y login con Google. No admite endpoints ni lógica de servidor a medida. Por eso la arquitectura del brief (backend Node + TS con motor en servidor) hay que adaptarla (sección 3).
3. **La base de conocimiento está limpia y lista para cargarse:** 133 FAQs, sin preguntas duplicadas, con 5 columnas (N°, Pregunta, Respuesta, Categoría, Palabras clave).
4. **Falta el HTML del prototipo** (`consola_emi.html`): no está adjunto ni en el repositorio. Es la fuente de verdad funcional y sin él no puede empezar la F1.

---

## 2. Descubrimiento (HECHOS verificados)

### 2.1 HubSpot — portal 51892044

| Elemento | Hallazgo | Impacto |
|---|---|---|
| Objetos con lectura | CONTACT, COMPANY, DEAL, TICKET | Base suficiente para el modelo estándar |
| Objetos personalizados | Ninguno visible | Las "operaciones" no existen como objeto |
| EMAIL (correos) | `REQUIRES_REAUTHORIZATION` | Hace falta el scope `sales-email-read` para leer la "última comunicación" |
| Escritura (tickets incluidos) | `REQUIRES_PERMISSION_MODIFICATION` con la conexión actual | La Private App debe tener el scope `tickets` |
| Contactos: documento CC | **No existe** | Bloquea 4.1 |
| Empresas: NIT | **No existe** (tampoco hay expediente ni razón social propia) | Bloquea 4.1 y 4.5 |
| Deals: número de operación | **No existe** | Bloquea 4.2 |
| Pipeline de deals | "Pipeline De Ventas": Prospección → Contactado → Calificado → Negociación → Cerrado Ganado / Cerrado Perdido | Es comercial, no refleja cobranza (al día / prejurídico / jurídico) |
| Pipeline de tickets | "Support Pipeline" (id `0`): New (`1`), Waiting on contact (`2`), Waiting on us (`3`), Closed (`4`) | Candidato para el escalamiento: pipeline `0`, etapa `1` |
| Volumen | 27 contactos, 1 deal ("HubSpot - New Deal (Sample Deal)") | Parece un portal de pruebas, no producción |

Propiedades personalizadas que **sí existen** y sirven para clasificar al cliente:

| Objeto | Propiedad | Tipo | Valores |
|---|---|---|---|
| Contacto | `rol_en_el_mercado` | enumeración | `vendedor`, `comprador_invertor` |
| Contacto | `estado_verificacion_cliente` | enumeración | `pendiente`, `aprobado`, `rechazado` |
| Contacto | `numero_facturas_vendidas` | número | — |
| Contacto | `volumen_cuentas_por_cobrar` | — | — |
| Contacto | `lifecyclestage` | enumeración | subscriber … customer … other |
| Empresa | `limite_credito_asignado` | — | — |
| Deal | `riesgo_asignado_categoria` | enumeración | `bajo`, `medio`, `alto` |
| Deal | `monto_financiamiento_esperado`, `porcentaje_descuento_ofrecido`, `tiempo_liquidacion_estimado` | — | — |

Ninguna de ellas indica "contratos pendientes" ni "mora".

### 2.2 Base de conocimiento (Google Sheet "Base de conocimiento")

- 133 filas, N° del 1 al 133, sin preguntas duplicadas.
- Categorías: Producto e inversión 43 · Requisitos y documentos 25 · Otro 24 · Pagos y facturación 24 · Estados y tiempos 16 · Horarios 1. Coinciden con las del prototipo.
- Largo de las respuestas: entre 86 y 723 caracteres (mediana 206).
- No tiene las columnas `fuente`, `activa` ni `fecha` que usa el prototipo; se completan al importar (`fuente = "Sheet base"`, `activa = true`, `fecha = fecha de importación`).
- Diferencia con el prototipo: 133 en el Sheet frente a ~132 en `BASE_DEFAULT`. Se reconcilia en la F1, cuando llegue el HTML.

### 2.3 Plataform Deployer

- Nombre `consola-emi` disponible → **https://consola-emi.apps.plataform.com**
- Lo que ofrece: frontend estático, MySQL con CRUD generado (tipos: INT, BIGINT, VARCHAR(n), TEXT, BOOLEAN, DECIMAL, DATETIME, DATE; sin JSON y sin claves foráneas), `ownerScoped` opcional por tabla, proxy de conexiones con el secreto inyectado en el servidor, login con Google y acceso por email vía `share_artifact`.
- Exige tests `*.test.js` con `node:test`, sin dependencias de npm.
- No permite endpoints a medida, cron, colas ni lógica de servidor.

---

## 3. Arquitectura propuesta (adaptada a las restricciones reales)

### Opción A — recomendada: consola en el Deployer + n8n como capa de integración

```
Navegador (consola)                Deployer (Express generado)          n8n (Plataform)              HubSpot / core Mesfix
 ├─ UI (mismo diseño)  ──/api/db──▶ MySQL: faqs, config, gaps…
 ├─ engine/ (JS puro)  ──/api/proxy/emi-n8n──▶ webhook con secreto ──▶ lookupClient ──────────────▶ contactos/empresas
 │   Mock | Remoto                                                      lookupOperation ───────────▶ operación + correos
 │                                                                      createTicket (idempotente) ▶ tickets
 │                                                                      audit_log (en n8n/BD)
 └─ tema en localStorage
                                    WhatsApp (fase posterior): HubSpot Conversations ─▶ n8n ─▶ mismo engine/
```

- **Motor (`engine/`)**: módulo JS puro, sin DOM, con interfaces inyectables `ClientLookup`, `OperationLookup` y `EscalationSink`. Corre en el navegador para el Playground y **el mismo archivo** corre en un nodo Code de n8n para WhatsApp. Una sola lógica, dos canales.
- **El token de HubSpot vive solo en n8n** (credencial de n8n). La consola solo conoce el secreto del webhook, que el proxy del Deployer inyecta del lado servidor; nunca llega al navegador.
- **Lógica de negocio sensible en n8n**: normalizar el documento, validar operación + empresa, deduplicar tickets (una conversación abierta = un ticket), reintentos con backoff ante 429/5xx, caché con TTL, enmascarado y `audit_log`. Desde el navegador estas reglas no se pueden garantizar.
- **Ventaja**: n8n ya existe en la empresa, el canal WhatsApp de HubSpot entra por ahí y no se construye ni mantiene un servidor nuevo.

### Opción B — todo dentro del Deployer (proxy directo a HubSpot)

El motor en el navegador llama a `api.hubapi.com` a través de `/api/proxy/hubspot`. Es más simple, pero:

- Cualquier usuario autenticado podría invocar cualquier endpoint de HubSpot dentro de los scopes y métodos permitidos. Se mitiga parcialmente con scopes mínimos, `allowedMethods` y conexiones con `baseUrl` acotada.
- El `audit_log` y la deduplicación de tickets se escriben desde el cliente, así que se pueden alterar.
- No sirve para WhatsApp, porque ahí no hay navegador.

**Recomendación:** Opción A. La B sirve solo como puente para una demo interna.

### Opción C — backend Node + TS propio (como pedía el brief)

Requiere un hosting distinto al Deployer, o confirmar que `deploy_coolify` acepta una app arbitraria. Duplica lo que ya hace n8n y queda fuera del flujo estándar de publicación. No la recomiendo salvo que TI la exija.

---

## 4. Mapeo HubSpot — propuesta, pendiente de decisión

El mapeo no se puede confirmar porque los datos no están en HubSpot. Hay dos caminos:

| | 4-I. Enriquecer HubSpot (recomendado si HubSpot será el CRM de servicio) | 4-II. Consultar el core de Mesfix directamente |
|---|---|---|
| Qué implica | Crear propiedades y sincronizarlas desde el core con n8n | n8n consulta la API o BD del core; HubSpot solo recibe tickets |
| Pros | Asesores y Emi ven la misma verdad; WhatsApp de HubSpot ya tiene el contexto | Dato en tiempo real, sin sincronizar |
| Contras | Sincronización y latencia; trabajo de admin en HubSpot | Hace falta una API del core y sus permisos |

Si se elige 4-I, estas son las propiedades nuevas que propongo. **No las creo sin tu OK** (el alcance es solo lectura + tickets):

| Objeto | Propiedad propuesta | Tipo | Uso |
|---|---|---|---|
| Contacto | `numero_documento` (solo dígitos, única) | texto | 4.1 |
| Contacto | `tipo_documento` | enumeración CC / CE / PAS | 4.1 |
| Contacto | `contratos_pendientes` | booleano | estado `inversionista+contratos_pendientes` |
| Contacto | `en_mora` | booleano | estado `mora` |
| Empresa | `nit` (sin DV, única) | texto | 4.1 / 4.2 |
| Empresa | `tipo_societario` | enumeración | 4.5 |
| Operación | objeto personalizado `operacion`, o un pipeline de deals "Operaciones" | — | 4.2 |
| Operación | `numero_operacion` (única) | texto | 4.2 |
| Operación | `estado_cobro`: `al_dia` / `prejuridico` / `juridico` | enumeración (o etapas del pipeline) | 4.2 |
| Operación | `expediente_supersociedades`, `tipo_proceso` | texto | 4.5 |

Reglas de estado del cliente: **son tuyas, no las supongo.** Esta es una propuesta para que la corrijas:

| Estado Emi | Regla candidata |
|---|---|
| `no_encontrado` | ningún contacto ni empresa con ese documento |
| `prospecto` | encontrado y `estado_verificacion_cliente ≠ aprobado`, o sin inversiones |
| `inversionista` | `rol_en_el_mercado = comprador_invertor` y `estado_verificacion_cliente = aprobado` |
| `inversionista+contratos_pendientes` | lo anterior y `contratos_pendientes = true` |
| `mora` | `en_mora = true` (¿aplica a inversionistas, a vendedores, o a ambos?) |

Escalamiento: pipeline `0` "Support Pipeline", etapa `1` "New". Falta confirmar el propietario o la cola por defecto. Las propiedades del ticket serían `subject`, `content` (resumen, intención, confianza, motivo, marca "contactar el próximo día hábil"), `hs_ticket_priority` y una propiedad nueva `emi_conversation_id` para garantizar la idempotencia.

Scopes de la Private App (para n8n): `crm.objects.contacts.read`, `crm.objects.companies.read`, `crm.objects.deals.read`, `tickets`, `sales-email-read`, y además `crm.objects.custom.read` y `crm.schemas.custom.read` solo si se crea el objeto `operacion`.

---

## 5. Modelo de datos (MySQL del Deployer)

JSON se guarda como TEXT. Los IDs son INT autoincrementales.

| Tabla | Columnas clave |
|---|---|
| `faqs` | id, pregunta VARCHAR(500), respuesta TEXT, categoria VARCHAR(60), keywords TEXT, fuente VARCHAR(120), activa BOOLEAN, version INT, updated_at DATETIME, updated_by VARCHAR(255) |
| `faq_versions` | id, faq_id INT, snapshot TEXT, changed_by, changed_at |
| `config` | id, version INT, payload TEXT, changed_by, changed_at (solo inserciones; la vigente es la de mayor versión) |
| `conversations` | id, channel VARCHAR(20), mode VARCHAR(10) (mock/hubspot), client_ref_masked, escalated BOOLEAN, ticket_id VARCHAR(40), started_at, closed_at |
| `messages` | id, conversation_id INT, role, text TEXT, intent, tipo, faq_id INT, confidence DECIMAL(4,3), latency_ms INT, created_at |
| `gaps` | id, pregunta TEXT, score DECIMAL(4,3), estado (abierta/corregida/convertida), faq_id INT, created_at |
| `feedback` | id, message_id INT, util BOOLEAN, comentario TEXT, created_at |
| `documents` | id, nombre, tipo, estado (pendiente/aprobado/rechazado), draft_faqs TEXT, created_by, created_at |
| `audit_log` | id, actor, accion, objeto, resultado, detalle_masked TEXT, created_at |
| `holidays` | id, fecha DATE (única), nombre VARCHAR(120) — carga 2026 y 2027 |

Riesgo conocido: el CRUD generado no valida ni versiona por sí mismo. El versionado y la auditoría de la consola los escribe el cliente, así que son trazabilidad operativa, no un control antifraude. La auditoría fuerte de las consultas a HubSpot queda en n8n (Opción A).

---

## 6. "Endpoints"

- **Deployer (generados):** `/api/db/{faqs|faq_versions|config|conversations|messages|gaps|feedback|documents|audit_log|holidays}` y `/api/db/<tabla>/<id>`.
- **n8n (webhooks vía `/api/proxy/emi-n8n`):**
  - `POST /emi/client-lookup` `{documento}` → `{estado, nombre, ref_masked, hubspot_id}`
  - `POST /emi/operation-lookup` `{numero_operacion, documento_empresa}` → `{estado_cobro, ultima_comunicacion:{fecha, asunto, resumen}, expediente?}`
  - `POST /emi/escalate` `{conversation_id, resumen, intent, confidence, motivo, fuera_horario, ref}` → `{ticket_id, created|existing}`
- Si un lookup falla: `{error: "upstream_unavailable"}`. El motor responde con el mensaje de "información insuficiente" y ofrece asesor; nunca inventa un estado.

---

## 7. Supuestos declarados

1. El portal 51892044 es de pruebas (sandbox). Falta saber cuál es el de producción.
2. Mientras no haya datos reales, la F1 y las pruebas usan los mocks del prototipo (documentos `79378202`, `1032416400`, `79491944`, `900876543`; operaciones `7981`, `6543`, `13058`).
3. El Sheet es la fuente de la carga inicial de FAQs; después la fuente de verdad es la tabla `faqs`.
4. Acceso: `share_artifact` funciona por email individual. Hay que confirmar si el Deployer admite el dominio `@plataform.com` completo o si se mantiene una lista de usuarios.
5. La extracción de PDF/DOCX/XLSX no puede hacerse en el servidor del Deployer. Se haría en el navegador o en n8n, siempre con revisión humana antes de incorporar.
6. Baranda Virtual: solo enlace oficial y expediente (si existe en HubSpot), sin scraping.

---

## 8. Plan por fases (ajustado)

| Fase | Entregable | Depende de |
|---|---|---|
| F1 | `engine/` extraído y probado con adaptadores Mock; consola conectada a `/api/db`; 133 FAQs cargadas; regresión de 30 preguntas igual al prototipo | **HTML del prototipo** |
| F2 | Webhooks n8n de lookup; tests de contrato con fixtures (401/429/500/timeout); 5 casos reales | Decisión 4-I o 4-II + datos poblados + token |
| F3 | Webhook de escalamiento idempotente + `audit_log` + enmascarado | Pipeline, etapa y cola confirmados |
| F4 | `deploy_artifact` en `consola-emi.apps.plataform.com` + `share_artifact` + `get_project_status` | F1–F3 en verde |
| Posterior | WhatsApp: HubSpot Conversations → n8n → `engine/` | F3 |

---

## 9. Indicadores (instrumentados desde F1)

| Indicador | Fórmula | Fuente | Meta |
|---|---|---|---|
| Resolución sin asesor | conversaciones con `escalated = false` ÷ total | `conversations` | ≥ 60 % |
| Preguntas sin respuesta | gaps ÷ mensajes de usuario | `gaps`, `messages` | ≤ 10 % |
| Éxito de consultas HubSpot | OK ÷ total | `audit_log` (n8n) | ≥ 99 % |
| Latencia p95 | p95(`latency_ms`) | `messages` | ≤ 3 s |
| Tickets duplicados | conversaciones con más de 1 ticket | n8n / HubSpot | 0 |

---

## 10. Recomendaciones fuera de alcance (no se implementan sin aprobación)

- **R1. Respaldo con un LLM sobre las FAQs, solo cuando el score sea menor al umbral**, con respuesta citada a la FAQ de origen y sin datos de cliente. Podría bajar los gaps sin perder control. Se mediría con un A/B en el Playground.
- **R2. Enriquecer HubSpot (4-I)** también beneficia a los asesores, no solo a Emi.
- **R3. El umbral de 0.35 debería calibrarse** con el set de regresión (curva de precisión y cobertura) en lugar de fijarse a mano.
