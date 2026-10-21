# Consola de Emi

Consola para probar y administrar a Emi, la asistente virtual de Mesfix. Se publica con el Plataform Deployer en `https://consola-emi.apps.plataform.com` (pendiente de publicar).

## Estructura

| Ruta | Qué es |
|---|---|
| `index.html`, `css/`, `js/app.js` | Interfaz: Playground, Panel, Base de conocimiento, Documentos, Preguntas sin respuesta y Ajustes |
| `js/engine/engine.js` | Motor de respuesta puro (sin DOM ni red). Reutilizable en n8n |
| `js/engine/menus.js` | Árbol de menús; las hojas apuntan a FAQs por su N° |
| `js/engine/mock.js` | Datos y adaptadores simulados (ficticios) |
| `js/engine/holidays.js` | Cálculo de festivos de Colombia para sembrar la tabla `holidays` |
| `js/data/faqs-base.js` | 133 FAQs del Sheet "Base de conocimiento" (carga inicial) |
| `js/adapters/remote.js` | Adaptadores hacia n8n vía `/api/proxy/emi-n8n` (timeout, reintento, caché de 60 s) |
| `js/store.js` | Datos: `/api/db/<tabla>` del Deployer; modo local solo fuera de producción |
| `js/lib/parsers.js` | CSV, TXT, DOCX, XLSX y exportar/importar con validación |
| `deploy/credentials.template.json` | Esquema de BD + conexión a n8n (sin secretos) |
| `n8n/` | Flujos importables de n8n (`workflows/`), generador (`build.js`), configuración y lógica (`src/`), prueba de humo (`smoke.sh`) y guía (`README.md`) |
| `tests/*.test.js` | `node:test`, sin dependencias |

## Correr localmente

```bash
python3 -m http.server 8765    # abre http://localhost:8765 (modo local: datos en el navegador)
node --test tests/*.test.js     # 138 pruebas
node n8n/build.js               # regenera los flujos de n8n tras editar n8n/src/
```

## Motor (orden de decisión)

1. Alias de menú (`menú`, `volver`, `9`).
2. Flujos abiertos: documento, operación, confirmación, oferta de asesor.
3. Opción de menú.
4. Reglas: asesor, reclamo, saludo, acceso al mercado, registro, operación.
5. FAQs: `score = 0.55·recall + 0.32·max(dice(q,pregunta), dice(q,keywords)) + 0.13·dice(q,pregunta)`, +0.06 por categoría del menú, tope 1.
6. Si `score < threshold` (0.35): registra la pregunta sin respuesta y ofrece asesor.

Una conversación genera como máximo un ticket. Si una consulta remota falla, Emi no inventa: responde el mensaje de "información insuficiente" y ofrece asesor.

## Datos personales

Los documentos se enmascaran (`CC ***416400`) en mensajes guardados, en el historial, en el debug y en la auditoría. `audit_log` es `ownerScoped`, así que el servidor registra el correo autenticado de quien hizo el cambio.

## Pendientes conocidos

- Las reglas de clasificación de clientes (consulta 2346), el pipeline y etapa de tickets y el host de n8n están por definir. Ver `n8n/README.md`.
- La extracción de PDF queda para n8n. CSV, TXT, DOCX y XLSX funcionan en el navegador.
- Falta verificar el formato real de respuesta del CRUD `/api/db` tras el primer deploy (`query_table_data`).
