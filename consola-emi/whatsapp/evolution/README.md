# WhatsApp de Emi con Evolution API

**Canal:** un número de WhatsApp dedicado a Emi, conectado a Evolution API (gratuito, de código abierto, en un servidor propio).
**Cerebro:** n8n, con el flujo `Emi · whatsapp`.
**Histórico:** HubSpot. Cada mensaje del cliente, de Emi y de los asesores queda en el contacto como comunicación de WhatsApp.

```
Cliente ──WhatsApp──▶ Evolution API ──webhook──▶ n8n (Emi · whatsapp) ──▶ Evolution API ──▶ Cliente
                                                   │
                                                   ├─▶ emi/client-lookup · operation-lookup · escalate (Metabase/HubSpot)
                                                   └─▶ HubSpot: contacto + histórico de WhatsApp + ticket si escala
```

> ⚠️ **Riesgo aceptado:** Evolution API no es un canal oficial de WhatsApp. Funciona imitando WhatsApp Web, lo que va contra las condiciones de WhatsApp: Meta puede bloquear el número.
> - Usar **un número nuevo, solo para Emi**. Nunca el número principal de Mesfix.
> - Solo **responder** a quien escribe. **Nunca** enviar mensajes masivos ni escribir primero a números que no han escrito.
> - Contar con el visto bueno de legal (tratamiento de datos, Ley 1581).

## 1. Instalar Evolution API (TI, ~20 min)
1. Crea el subdominio, por ejemplo `evolution.plataform.com`, apuntando al servidor.
2. **En Coolify:** crea un recurso *Docker Compose*, pega `docker-compose.yml` y agrega las variables de `env.example` con sus valores. Si Coolify tiene la plantilla oficial "Evolution API", también sirve: aplica las mismas variables de privacidad (`DATABASE_SAVE_DATA_*=false`).
   **Sin Coolify:** copia `env.example` como `.env`, complétalo y corre `docker compose up -d`.
3. Comprueba que `https://evolution.plataform.com` responde. El panel queda en `https://evolution.plataform.com/manager`.

## 2. Conectar el número de Emi (5 min)
1. Instala **WhatsApp Business** en un teléfono con la SIM del número nuevo y actívalo.
2. Entra a `/manager` con la `AUTHENTICATION_API_KEY` → **Create instance**: nombre `emi`, integración *Baileys*.
3. En la instancia, pulsa **Connect** y escanea el QR desde WhatsApp Business (*Dispositivos vinculados → Vincular un dispositivo*). El teléfono puede quedar guardado; no necesita estar encendido todo el tiempo.

## 3. Configurar el flujo en n8n (10 min)
1. Genera el token de la URL con `openssl rand -hex 16`.
2. Importa `n8n/workflows/emi-whatsapp.json` y edita el nodo **Config**:
   - `evolutionUrl`: `https://evolution.plataform.com`
   - `webhookToken`: el token del paso 1. Pon el mismo token en la ruta del nodo **Webhook**: `emi/whatsapp-<token>`.
   - `emiSecret`: el mismo valor de la credencial *Emi · secreto del webhook*.
3. Crea la credencial **Evolution · API key (apikey)** (tipo *Header Auth*, nombre de cabecera `apikey`, valor `AUTHENTICATION_API_KEY`) y asígnala al nodo *Evolution · enviar*.
4. Asigna la credencial de HubSpot a los nodos *HubSpot*. La Private App necesita además los scopes de **escritura de contactos** y de **comunicaciones**; HubSpot los muestra al editar los scopes.
5. **Activa** el flujo. El estado de cada conversación solo se guarda con el flujo activo, no en ejecuciones manuales.

## 4. Conectar Evolution con n8n (2 min)
En `/manager` → instancia `emi` → **Webhook**:
- **URL:** `https://n8n.plataform.com/webhook/emi/whatsapp-<token>`
- **Enabled:** sí · **Webhook by events:** no · **Base64:** no
- **Eventos:** solo `MESSAGES_UPSERT`

## 5. Probar
Desde otro teléfono escribe "Hola" al número de Emi. Deberías ver:
- La respuesta de Emi en WhatsApp, con el menú.
- En HubSpot, el contacto (creado si no existía), con los dos mensajes en su actividad, tipo *WhatsApp*.
- Al escribir "quiero hablar con un asesor": un ticket asociado al contacto. Emi deja de responder 12 h en esa conversación.

## Cómo atienden los asesores
- **Desde el teléfono o WhatsApp Web vinculado al número de Emi.** Cuando un asesor escribe, Emi se calla 12 h en esa conversación y el mensaje del asesor también queda en HubSpot.
- **El cliente puede volver al bot** escribiendo "menú".

## Límites conocidos
- Si un cliente manda varios mensajes muy seguidos, dos ejecuciones pueden pisarse el estado de la conversación. Es raro en atención 1:1; si molesta, se activa la cola de n8n.
- Si WhatsApp cambia su protocolo, Evolution puede dejar de funcionar hasta que publiquen una actualización. Hay que mantenerlo actualizado.
- Las imágenes y audios no se procesan: Emi pide escribir el mensaje.
- Las búsquedas de contacto por teléfono en HubSpot usan `hs_searchable_calculated_phone_number` y similares. Hay que validarlas con números reales del portal 2917670.
