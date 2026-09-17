# Typebot — flujo de conversación sobre el bot server

Este directorio levanta [Typebot](https://typebot.io) auto-hospedado (open
source). Typebot se encarga de la interfaz visual del chat y del flujo de
conversación; las respuestas siguen viniendo del backend en `server/`
(Google Doc + Gemini) a través de un bloque de **Webhook**.

```
Usuario → Widget/chat de Typebot → Webhook block → server/ (Google Doc + Gemini) → respuesta
```

## 1. Configurar variables de entorno

```bash
cd typebot
cp .env.example .env
```

Completar en `.env`:

- `ENCRYPTION_SECRET`: generar con `openssl rand -base64 32`
- `NEXTAUTH_URL`: URL pública del builder (editor de flujos), ej.
  `https://bot-admin.tuempresa.com`
- `NEXT_PUBLIC_VIEWER_URL`: URL pública del viewer (el chat que ve el
  usuario final), ej. `https://bot.tuempresa.com`
- `ADMIN_EMAIL`: tu email para iniciar sesión como administrador

Typebot requiere un método de login (magic link por email vía SMTP, o un
proveedor OAuth como Google/GitHub). Configurarlo según la
[guía oficial de autenticación](https://docs.typebot.io/self-hosting/configuration/auth)
— no viene incluido en este `.env.example` porque depende de qué proveedor
uses.

## 2. Levantar Typebot

```bash
cd typebot
docker compose up -d
```

- Builder (editor): el puerto `8080` → configúralo detrás de tu proxy/dominio
- Viewer (chat público): el puerto `8081` → configúralo detrás de tu
  proxy/dominio

## 3. Construir el flujo dentro del builder

1. Entrar al builder con tu `ADMIN_EMAIL`, crear un typebot nuevo.
2. Agregar un bloque de **Text input** (pregunta al usuario) y guardarlo en
   una variable, ej. `pregunta`.
3. Agregar un bloque de **Webhook**:
   - Método: `POST`
   - URL: la URL pública de tu `server/` + `/api/chat`
     (ej. `https://api.tuempresa.com/api/chat`)
   - Body: `{ "question": "{{pregunta}}" }`
   - Guardar la respuesta (`answer`) en una variable, ej. `respuesta`
4. Agregar un bloque de **Text** que muestre `{{respuesta}}`.
5. Publicar el bot y copiar el snippet de embed (o usar el link directo del
   viewer) para ponerlo en el sitio web.

## Nota

El widget custom en `public/` (widget.js/css) queda como referencia o como
alternativa liviana sin depender de Typebot. No hace falta usar ambos a la
vez.
