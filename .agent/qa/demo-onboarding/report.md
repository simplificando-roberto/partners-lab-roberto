# QA — onboarding, costes Stripe y reinicio

## Veredicto local: PASS

Verificado por el coordinador el 2026-09-10, tras las correcciones de la revisión independiente Luna.

- Backend: 32 tests pasan (2 avisos de deprecación de Starlette).
- Frontend: 14 tests pasan, 0 fallos y 0 omitidos; Chromium real con API/Stripe simulados.
- Cobertura: Express listo/incompleto/restringido y retorno, reinicio/cancelación/error/concurrencia, guía y teclado desde todas las pestañas, coste estimado variable, coste confirmado, coste pendiente y neto negativo tras devolución.
- Revisión visual: escritorio 1440 y móvil 390; capturas en `screenshots/` y `regression/`. Sin desbordamiento horizontal en los recorridos comprobados.
- Revisión independiente: se corrigió el acceso global a la guía. El coordinador corrigió mediante el owner las etiquetas confirmado/estimado y la explicación del neto tras devolución.
- Un primer test de Express falló por esperar el texto antiguo; se actualizó conservando las comprobaciones del destino y el bloqueo.

Los agentes no pudieron iniciar Chromium en su sandbox. Esos intentos no cuentan como PASS; la ejecución final anterior pertenece al coordinador fuera de esa restricción. Las pruebas con fixtures no prueban cobros reales en Stripe. La estimación enlaza a la tarifa publicada de Stripe España para tarjetas estándar del EEE, consultada el 2026-09-10; no representa una tarifa universal ni el coste total de Connect.

## Publicación

Pendiente de registrar SHA y readback de la publicación.
