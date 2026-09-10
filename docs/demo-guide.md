# Guía rápida de la demo

## Antes de empezar

Abre [partners-lab-roberto.vercel.app](https://partners-lab-roberto.vercel.app). Es una demo pública de Stripe TEST. No uses datos personales ni una tarjeta real. El cobro se introduce en la página alojada por Stripe, no en Partners Lab.

Puedes elegir entre dos recorridos.

## Ruta 1: probar con el partner de ejemplo

1. Entra en `Cobros`.
2. Deja el importe y la comisión que aparecen, o cambia sus valores dentro de los límites de la pantalla.
3. Pulsa `Probar pago con Stripe`.
4. En Checkout usa `4242 4242 4242 4242`, una fecha futura y CVC `123`.
5. Vuelve a la demo para consultar el pago, la transferencia, la comisión y el estado del webhook.
6. Si quieres, introduce un importe parcial y pulsa `Devolver`.

En esta ruta, el destino es la cuenta Custom TEST de ejemplo cuando está configurada y tiene `transfers` activo. No hay dinero real.

## Ruta 2: dar de alta tu propio partner Express TEST

1. Abre `Partners` y pulsa el alta Express.
2. Sigue el Account Link alojado por Stripe. Completa solo con datos de prueba.
3. Al volver a Partners Lab, pulsa continuar o actualizar si la pantalla lo pide.
4. Comprueba el estado de la cuenta. Una sola cuenta Express TEST queda asociada a esta sesión firmada del navegador durante una hora.
5. Vuelve a `Cobros`. El destino debe indicar la cuenta Express de esta sesión.
6. Haz el pago de prueba en Checkout.

Estados que puedes ver:

- **Sin cuenta:** todavía no se ha creado una cuenta Express para esta sesión.
- **Alta empezada o incompleta:** Stripe aún pide datos o la cuenta está restringida. Puedes continuar el alta, pero Checkout queda bloqueado.
- **Lista:** `transfers` está activo. La demo permite Checkout y usa esa cuenta como destino.
- **Payouts no habilitados:** no impide esta prueba. Los payouts bancarios son otro estado y no se prueban aquí.

Volver desde Stripe no demuestra que el alta haya terminado. La demo consulta la cuenta y exige `transfers` activo antes de permitir el cobro. Si la sesión caduca, empieza una nueva.

## Cómo leer el reparto

Para un cobro de 100 € con una comisión de plataforma del 10 %:

| Concepto | Qué significa |
| --- | --- |
| Importe bruto cliente | Lo que paga el cliente: 100 € |
| Comisión plataforma bruta | La comisión que gana la plataforma: 10 € |
| Coste Stripe estimado | Estimación previa para una tarjeta estándar del EEE: 1,5 % + 0,25 € |
| Neto plataforma | Comisión bruta menos el coste Stripe. Antes del pago es estimado; después usa el coste real de Stripe |
| Importe partner | El resto, 90 €, que se transfiere al saldo de Stripe del partner |

La vista previa muestra el coste Stripe estimado de forma visible. Es una hipótesis ilustrativa, no una tarifa universal ni el coste total de Connect: otras tarjetas, divisas, cuentas y cargos adicionales pueden variar. Consulta las [tarifas oficiales de Stripe](https://stripe.com/es/pricing). Después del pago, la tarjeta de resultado usa los importes reales que devuelve Stripe; si aún no llegan, muestra **Pendiente**, sin estimar.

## Devoluciones

Una devolución parcial o total solicita a Stripe tres cosas relacionadas:

- devolver el importe al cliente,
- revertir la transferencia al partner en la misma proporción,
- devolver la comisión de aplicación de la plataforma en la misma proporción.

El coste de procesamiento de Stripe puede permanecer aunque se devuelva el cobro. Por eso el neto de plataforma puede quedar reducido o incluso ser negativo después de una devolución. El importe restante del partner refleja lo que queda en su saldo de Stripe. Comprueba el resultado en el resumen principal y actualiza la consulta si el webhook todavía está pendiente.

## Reiniciar la demo

`Reiniciar demo` crea una sesión de navegador nueva y borra la asociación Express de la sesión anterior. También limpia la simulación local. Stripe conserva las cuentas, Checkout y pagos ya creados; el reinicio no devuelve nada.

Si necesitas devolver un pago, hazlo antes de reiniciar. Después de reiniciar, la cookie nueva ya no permite consultar el resultado de la sesión anterior. La cuenta Express que Stripe ya creó tampoco se elimina, pero esta demo no la vuelve a asociar desde la sesión nueva.

## Simulación local

La pestaña de simulación no llama a Stripe. Sirve para explorar cobros aceptados, rechazos, altas ficticias, reembolsos y eventos repetidos sin crear objetos externos. Sus importes y costes son ilustrativos. No prueban que Checkout, Connect, webhooks o devoluciones funcionen en Stripe.

## Qué demuestra esta demo

El recorrido demuestra una integración TEST de Checkout con Destination Charges, una comisión de plataforma, un destino Connect, consulta de estados y devoluciones con reversión de transferencia y comisión de aplicación. También muestra el control básico de pertenencia mediante una sesión firmada de una hora.

No es un marketplace listo para producción. Faltan login e identidad por tenant, un ledger persistente y auditable, reconciliación, límites operativos, soporte, emails, billing recurrente y un diseño completo de payouts y responsabilidades.

## La pestaña "Lanzamiento"

`Lanzamiento` es una propuesta explícita de trabajo alrededor de este recorrido, no una funcionalidad ya disponible. Presenta posibles siguientes fases como acceso, billing recurrente, emails, operaciones, seguimiento y despliegue para acordar alcance, prioridades y hitos.
