# Pendientes del radicador para la sesión del martes 2-dic-2026 con Mario

Fuente: notas de Gemini de la "Capacitación Radicación" (27-nov-2026) y pruebas en HubSpot (26 y 28-nov-2026).

## Decisiones a tomar

| # | Tema | Situación actual | Decisión requerida | Origen |
|---|------|------------------|--------------------|--------|
| 1 | Facturas desde $2.000.000 | El radicador no aplica la regla. Álvaro la definió como alcance de la fase 1; las facturas menores se radican por el método tradicional. Xiomara tiene clientes de alimentos con facturas de ~$200.000 | Confirmar la regla, ajustarla o eliminarla. Si se mantiene: ¿por factura o por operación? | Capacitación 27-nov |
| 2 | Alerta de usura | Hoy bloquea en rojo si la tasa cliente supera el tope de usura Plataform | Pasarla a aviso amarillo y agregar casilla "el cliente asume la tasa", que quede en la nota para Karen | Capacitación 27-nov (Xiomara) |
| 3 | Ruta deal y "¿De dónde llegó el negocio?" | Se copian del último negocio del cliente en HubSpot. En AMA vienen Growth B2B y vacío, y el inbox los marca en rojo | ¿AMA es Growth B2B (se ajusta la regla del inbox) o se corrige su histórico? | Prueba AMA 28-nov |
| 4 | Nombre Emisor / Nit Emisor | Quedan vacías; el radicador llena "Nombre/Nit empresa (cliente del KAM)" | ¿Se llenan también, o Katherine unifica u oculta las duplicadas? | Prueba 26-nov, correo a Álvaro |
| 5 | Inicio de pruebas con clientes reales | Xiomara y Karen arrancan el lunes 1-dic | Confirmar el arranque y el seguimiento hasta la revisión de Karen | Capacitación 27-nov |

## Ya resuelto (para informar)

- Capacitación al área comercial realizada el 27-nov; presentación, grabación y enlace compartidos.
- Tasas máximas con varios pagadores: el negocio lleva la tasa más alta y el detalle sigue en la nota (commit 437f8f5).
- Tipo de radicación = Radicador y ¿Fondeo estructurado? = No: el inbox ya filtra y cumple esas condiciones.
- Correo del cliente opcional, con varios correos separados por coma.
- Valor de las facturas: el radicador usa el valor neto calculado y, si no existe, el valor neto.

## Pendiente técnico conocido

- Flujo `Correos_pagadores`: en la última prueba la nota decía "no se pudieron traer". Hay que verificar que esté importado y publicado en n8n.
