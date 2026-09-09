# QA de Partners Lab — PASS

Fecha: 10 de septiembre de 2026. Profundidad: exhaustive, por petición de Roberto y por los riesgos de sesiones, pagos, webhooks y publicación.

**Objeto probado:** demo de Stripe sandbox, revisión `14859fdf11bb2c2fd0a9b37cb9fe940d59347d70`. Despliegue `dpl_FT9GJ77DDqakMFGKQYeruniGH3QB`, https://partners-lab-roberto.vercel.app. `/release.json` publica la revisión y se compararon byte a byte los cinco archivos del frontend.

## Cobertura ejecutada

- 8 pruebas Node del ledger y 19 pruebas pytest de API y seguridad: todas pasan.
- Chromium: 1440×1000, 768×1024 y 390×844. Navegación, teclado, validación, error/reintento, simulación, rechazo, alta ficticia, reembolso parcial/total, duplicados, reinicio y estados sin configuración o sin acceso.
- Stripe real en **sandbox**: Checkout de 100 EUR, comisión de 10 EUR, partner 90 EUR y webhook firmado. Reembolso 30 EUR, repetición con el mismo ID sin duplicado y reembolso restante 70 EUR. Segundo Checkout 25 EUR con devoluciones 10 + 15 desde los botones de la web.
- Dos sesiones válidas distintas: lectura y devolución ajenas rechazadas con 403. Origin ajeno 403, firma manipulada 400, cookies inválidas/caducadas y evento live rechazados.
- Dos Checkout simultáneos con la misma clave: uno fue aceptado y el otro obtuvo un error temporal 502; el reintento devolvió el mismo Checkout. No se crearon dos sesiones ni se movió dinero en esta comprobación.
- Despliegue final: revisión exacta y archivos idénticos; tres viewports sin errores JavaScript ni peticiones fallidas inesperadas.
- Dos revisiones independientes con llm-delegate: código/seguridad y capturas/flujo. Los resultados originales están en `reviews/`; la adjudicación del coordinador está en `report.json`.

## Hallazgos y reparación

Se corrigieron la incompatibilidad del SDK, el estado de devolución completa, el identificador cortado en móvil, la columna estrecha en tablet, la ausencia de una nueva prueba visible y los valores iniciales que no reflejaban el pago devuelto. Se repitieron las pruebas afectadas y las capturas finales.

El revisor de código marcó como P1 una supuesta falta de empaquetado. Se descartó con evidencia: el README raíz y `scripts/prepare_release.py` ya documentaban y ejecutaban el paso; la publicación desde esa salida terminó correctamente. Su observación sobre el ID de webhook se acota al contrato: es un ejemplo de firma verificada, no un historial ordenado ni contabilidad. Repetirlo no ejecuta efectos financieros. El texto visible lo aclara.

Durante la automatización también se corrigieron dos defectos del propio test: había que abrir el nuevo desplegable de reembolsos y esperar a que Stripe aportara los datos del reparto tras confirmar el pago. La operación interrumpida se devolvió íntegramente.

## Reproducir y revisar

Ejecutar los comandos de pruebas y empaquetado del README raíz. En la demo, abrir Checkout con los datos TEST mostrados, volver al resultado y solicitar devoluciones. Probar Partners y Lanzamiento con teclado. Usar los tres tamaños anteriores para revisar las capturas de `screenshots/`. La evidencia monetaria está en `demos/partner-payments/SANDBOX_EVIDENCE.json`; los JSON de esta carpeta contienen resultados de navegador, concurrencia e identidad del despliegue.

## Exclusiones

Este PASS cubre la demo declarada. No valida dinero real, alta Express, payouts, Billing recurrente ni un marketplace productivo con identidad/tenant, ledger persistente y reconciliación. Tampoco afirma cobertura Firefox/Safari o capacidad bajo carga. Esas funciones no se presentan como terminadas.

No quedan bloqueos conocidos dentro del alcance probado. Artefactos y hashes: `report.json`.
