# Academia Plataform

Espacio de capacitación para personas nuevas: videos, cursos interactivos, quizzes, juegos en vivo estilo Kahoot y cursos generados con IA a partir de PDF, Word, Excel, PowerPoint, páginas web o texto. El contenido se puede editar y actualizar en cualquier momento, con historial de versiones.

## Qué incluye

| Para quien aprende | Para quien administra |
|---|---|
| Elige su área al ingresar y ve solo los cursos de su área y los de toda la empresa |
| Catálogo de cursos con búsqueda y categorías | **Crear curso con IA**: sube archivos, URL o texto y obtén lecciones + quizzes |
| Lecciones de video (subido, YouTube, Vimeo, Drive), lectura y quiz | Editor de cursos: lecciones, videos, preguntas, orden, vista previa |
| Progreso por curso, XP, niveles, insignias y ranking | **Actualizar con IA**: sube el material nuevo y la IA propone qué cambiar |
| Quiz con explicación por pregunta (aprueba con 70 %) | Historial de versiones con nota de cambio y restauración |
| Juego en vivo desde el celular: lista de partidas abiertas de su área, o PIN sin necesidad de cuenta | Juego en vivo proyectable: lobby, temporizador, respuestas, ranking y podio |
| | Panel con indicadores por curso y alertas de cursos con baja nota o finalización |
| | Gestión de personas, roles y áreas (lista controlada; cada curso define a qué áreas va dirigido) |
| | Avance promedio por área en el panel |

Formatos de fuente soportados: `.pdf`, `.docx`, `.xlsx`, `.csv`, `.pptx`, `.txt`, `.md`, `.json`, `.html`, URL pública y texto pegado. Los PDF escaneados (imagen) necesitan OCR previo.

## Ponerlo en marcha

Requiere Node.js 22.13 o superior.

```bash
npm install
cp .env.example .env      # opcional: completa ANTHROPIC_API_KEY, ADMIN_EMAILS, ALLOWED_EMAIL_DOMAIN
npm start                 # http://localhost:3000
```

La primera persona que ingresa queda como administradora. Sin `ANTHROPIC_API_KEY` la plataforma funciona completa, pero la generación usa un **modo básico** (divide el material en secciones y arma preguntas de completar la frase); con la clave, Claude redacta lecciones y preguntas de comprensión. "Actualizar con IA" requiere la clave.

Con Docker:

```bash
docker build -t academia .
docker run -p 3000:3000 -v academia-data:/data -e ANTHROPIC_API_KEY=... academia
```

`DATA_DIR` debe apuntar a un volumen persistente: ahí viven la base de datos y los videos subidos.

## Cómo se usa

1. **Crear con IA** → arrastra tus manuales → "Generar curso". Se crea como borrador.
2. Revisa en el editor, agrega videos (sube un archivo o pega un link) y **Publica**.
3. Cuando cambie una política o proceso: abre el curso → **Actualizar con IA** → sube el documento nuevo. La IA conserva lo vigente, cambia lo necesario y escribe la nota de versión. Nada se guarda hasta que lo revisas; el progreso de las personas se conserva.
4. Para una sesión grupal: **Juego en vivo** → proyecta la pantalla → las personas entran desde el celular con el PIN.

## Demo interactiva sin servidor

`npm run build:demo` genera `demo/dist/academia-demo.html`: la misma interfaz con un backend simulado en el navegador (datos de ejemplo, lectura real de PDF/Word/Excel/PowerPoint, juego con participantes simulados). Publicada dentro de Claude usa la IA de la cuenta de quien la abre.

## Versión sin servidor con Supabase (Netlify + Supabase, plan gratis)

Datos compartidos reales sin mantener un servidor: la interfaz se publica como un solo `index.html` en Netlify y los datos viven en Supabase.

1. Supabase → **SQL Editor** → pega `supabase/schema.sql` completo → **Run** (se puede repetir sin perder datos).
2. Supabase → **Authentication → Sign In / Providers → Email** → desactiva **Confirm email**.
3. `npm run build:supabase` → arrastra `supabase/dist/` a [app.netlify.com/drop](https://app.netlify.com/drop).
4. La **primera cuenta** que se crea queda como administradora. Solo se aceptan correos `@plataform.com` (`app_config.allowed_domain`).

Seguridad: el navegador no tiene acceso a las tablas; todo pasa por funciones `app_*` que validan permisos, corrigen los quizzes y asignan los puntos en la base de datos. La URL y la clave publicable están en `supabase/config.js`.

Diferencias con la versión con servidor: videos por link (YouTube no listado, Vimeo o Drive), IA en modo básico, sin lectura de URLs, y el juego en vivo llega en la siguiente etapa.

## Arquitectura

```
server/
  app.js                 rutas HTTP (Express) y autorización
  db.js                  esquema SQLite (node:sqlite), transacciones
  repositories/          acceso a datos: users, courses (+versiones), learning (progreso, XP, métricas)
  services/
    extract.js           extracción de texto de cada formato + protección SSRF para URLs
    ai.js                generación/actualización con Claude (salida estructurada) y modo básico
    live-game.js         motor del juego en vivo (estado en memoria + Server-Sent Events)
public/                  SPA sin paso de compilación (HTML + CSS + módulos JS)
tests/                   pruebas de API, extracción, juego e IA (npm test)
```

Decisiones relevantes:

- **Tres capas separadas** (interfaz, reglas, datos): migrar a Postgres/MySQL solo toca `db.js` y `repositories/`.
- **Datos listos para migrar**: ids UUID, fechas ISO 8601 en UTC, sin datos quemados en el código.
- **La IA propone, una persona decide**: la generación crea borradores y la actualización devuelve una propuesta que hay que guardar explícitamente.
- **Las respuestas correctas nunca llegan al navegador antes de responder**: la corrección de quizzes y del juego ocurre en el servidor.
- **El progreso sobrevive a las ediciones**: las lecciones conservan su id al editar o actualizar con IA.

## Indicadores sugeridos

| Indicador | Fórmula | Meta inicial | Frecuencia |
|---|---|---|---|
| Finalización de inducción | personas que terminaron ÷ personas que empezaron | ≥ 80 % | semanal |
| Nota promedio en quizzes | Σ(aciertos ÷ preguntas) ÷ intentos | ≥ 80 % | semanal |
| Personas activas | personas con XP en los últimos 7 días ÷ personas nuevas | ≥ 70 % | semanal |
| Frescura del contenido | cursos actualizados en los últimos 6 meses ÷ cursos publicados | 100 % | mensual |

Los tres primeros se ven en el **Panel**; el panel marca automáticamente los cursos con nota < 70 % o finalización < 50 %.

## Pendiente antes de producción

- **Inicio de sesión real**: hoy se ingresa con el correo (sin clave), útil para piloto interno. Antes de abrirlo, conectar Google Workspace SSO y fijar `ALLOWED_EMAIL_DOMAIN`.
- **Almacenamiento de videos**: se guardan en disco (`DATA_DIR`). Para muchos videos o varias instancias, mover a almacenamiento de objetos (S3/GCS) o enlazar desde YouTube/Drive no listados.
- **Juego en vivo**: el estado vive en memoria de una instancia. Para escalar horizontalmente, mover el estado a Redis.
- `npm audit` reporta 2 avisos moderados en dependencias transitivas (`sprintf-js` vía la CLI de `mammoth`, `uuid` vía `exceljs`) en código que la plataforma no ejecuta.

## Pruebas

```bash
npm test
```

Cubren: permisos por rol, flujo completo de curso (crear → publicar → aprender → quiz → XP → versiones → restaurar), conservación de progreso al editar y al actualizar con IA, extracción real de Word/Excel/PowerPoint/PDF, bloqueo de URLs internas, subida de videos con streaming por rangos y una partida en vivo completa por HTTP + SSE.
