# Agente de automatización de procesos

Agente interno que automatiza procesos de la empresa. El primer proceso cubierto
es **gestión de proyectos** (Asana y Jira Cloud): reportes de estado, seguimiento
de tareas estancadas y conversión de texto libre en tareas.

Construido con el [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk)
en TypeScript. Se opera desde la línea de comandos.

---

## Arrancar en 5 minutos

```bash
npm install
cp .env.example .env      # rellena ANTHROPIC_API_KEY y las credenciales que uses
npm run agente -- doctor  # comprueba que todo conecta
npm run agente -- list    # ver los procesos disponibles
```

`doctor` es el primer comando que deberías correr siempre: valida las
credenciales contra cada API y te dice exactamente qué falta.

Luego, el primer proceso real (sólo lectura, no puede romper nada):

```bash
npm run agente -- run reporte-semanal --dias=7
```

Deja el informe en `salidas/reporte-<fecha>.md`.

---

## La idea: procesos como *playbooks*

Un **playbook** es un proceso de la empresa escrito una vez y ejecutable siempre.
Vive en un único archivo de `src/playbooks/` y declara qué necesita, si escribe
y cuál es el procedimiento.

Automatizar un proceso nuevo = añadir un archivo. No se toca el runner, ni el
CLI, ni los conectores. Eso es lo que hace que esto pase de un proceso a veinte
sin reescribirse.

Los tres que vienen incluidos:

| Playbook | Qué hace | Escribe |
|---|---|---|
| `reporte-semanal` | Informe de estado de los últimos N días en `salidas/` | No |
| `tareas-estancadas` | Comenta las tareas vencidas o sin movimiento | Sí |
| `triage-entrada` | Convierte un correo o notas de reunión en tareas | Sí |

```bash
npm run agente -- run tareas-estancadas                     # propone
npm run agente -- run tareas-estancadas --aplicar           # ejecuta
npm run agente -- run triage-entrada --archivo=notas.txt
npm run agente -- chat "¿qué vence esta semana y quién lo tiene?"
```

---

## Seguridad: simulación por defecto

**Ningún playbook escribe si no pasas `--aplicar`.** Y eso no es una instrucción
en el prompt que el modelo pueda ignorar: las herramientas de escritura
literalmente no se le pasan al agente en modo simulación, así que no existen
para él. Cada conector clasifica sus herramientas en lectura y escritura, y el
runner sólo autoriza el segundo grupo cuando tú lo pides
(`autorizarHerramientas` en `src/agente.ts`).

Es la invariante más importante del proyecto y está cubierta por pruebas:

```bash
npm test
```

Otras decisiones deliberadas en la misma línea:

- **Toda corrida se registra** en `bitacora/corridas.jsonl`: qué playbook, en qué
  modo, qué herramientas se autorizaron, cuáles se usaron y con qué coste. Cuando
  un agente modifica los sistemas de la empresa, "¿quién hizo este cambio?" tiene
  que tener respuesta.
- **Corridas herméticas**: `settingSources: []` y `strictMcpConfig: true`. El
  agente sólo ve lo que el código le da, sin ajustes del entorno ni `.mcp.json`.
  Una corrida es reproducible.
- **Los playbooks que escriben tienen topes** (por ejemplo 25 tareas por corrida)
  y evitan repetir seguimientos, porque la forma más rápida de que un equipo
  silencie al agente es que les llene la bandeja.
- **Prohibido inventar**: los prompts exigen que todo dato salga de una
  herramienta, y que lo que falta se reporte como faltante.

---

## Arquitectura

```
src/
├── cli.ts              Entrada: doctor, list, run, chat
├── agente.ts           Runner: monta las opciones del SDK y autoriza herramientas
├── config.ts           Configuración desde el entorno; activa conectores solos
├── conectores/
│   ├── tipos.ts        Contrato de conector (lectura vs escritura)
│   ├── asana.ts        8 herramientas sobre la API de Asana
│   └── jira.ts         9 herramientas sobre la API de Jira Cloud v3
├── playbooks/          Un archivo por proceso automatizado
└── lib/                HTTP, bitácora, render de la salida
```

Los conectores son **servidores MCP en proceso** (`createSdkMcpServer`), no
procesos aparte. Se eligió así en lugar de los servidores MCP remotos oficiales
de Asana y Atlassian porque esos usan OAuth interactivo, y el Agent SDK no abre
un navegador: un agente que va a correr desatendido en un cron necesita
autenticarse con un token. Además, tener las herramientas en casa permite
imponer la separación lectura/escritura, recortar las respuestas antes de que
inflen el contexto y devolver errores que el agente sepa accionar.

### Añadir un conector

Implementa la interfaz `Conector` de `src/conectores/tipos.ts` y regístralo en
`src/conectores/index.ts`. Lo que hace `asana.ts` en 250 líneas es la plantilla.

### Añadir un playbook

Crea el archivo en `src/playbooks/`, implementa `Playbook` y añádelo al arreglo
de `src/playbooks/index.ts`. Aparece solo en `list` y en `run`.

---

## Credenciales

Todo por variables de entorno; no hay secretos en el repositorio. Ver
`.env.example`. El agente activa cada conector cuando encuentra sus credenciales
completas, así que puedes empezar sólo con Asana, sólo con Jira, o con los dos.

- **Asana**: token personal de acceso, en Configuración → Apps.
- **Jira Cloud**: token de API en
  `id.atlassian.com/manage-profile/security/api-tokens`, más el correo de la
  cuenta y el subdominio del sitio.

Cuidado con esto: el agente hereda los permisos de la cuenta cuyo token uses.
Para operar en producción, crea una cuenta de servicio con acceso sólo a los
proyectos que deba tocar, en lugar de usar un token personal de administrador.

---

## Hoja de ruta

Lo que viene, en el orden en que aporta más:

1. **Programación automática.** Los playbooks ya declaran su `cronSugerido`; falta
   ejecutarlos desatendidos (cron del sistema, GitHub Actions programado, o un
   `deployment` de Managed Agents) y que reporten por correo o al canal del equipo.
2. **Segundo dominio de proceso.** Ventas/CRM o triage de correo, reutilizando
   el mismo motor de playbooks con un conector nuevo.
3. **Aprobación en el bucle.** Hoy la revisión humana es leer la simulación y
   volver a correr con `--aplicar`. Un paso de aprobación por elemento (aprobar
   3 de 8 acciones propuestas) haría el modo `--aplicar` mucho más usable.
4. **Métricas del proceso.** La bitácora ya tiene los datos; falta explotarla:
   cuánto trabajo repetitivo se ha absorbido, cuántas propuestas se aprueban.

---

## Comandos

```bash
npm run agente -- ayuda   # todos los comandos y opciones
npm test                  # pruebas
npm run typecheck         # comprobación de tipos
```
