# Demo de partners

URL pública: https://partners-lab-roberto.vercel.app
Proyecto Vercel aislado: `partners-lab-roberto`.
Verificado: 10 de septiembre de 2026.

## Alcance

La demo abre sin login y conecta con Stripe sandbox. El bloque principal permite abrir Checkout, consultar el reparto y solicitar devoluciones de prueba. El simulador local está separado: sus importes ilustrativos no representan la contabilidad de Stripe. Lanzamiento presenta el trabajo de Roberto como interlocutor directo y las tareas de su ecosistema.

El backend `../partner-payments-stripe/` implementa Checkout Destination Charges, cookies firmadas, pertenencia de sesión, claves de idempotencia y verificación de firmas de webhook. Rechaza claves live. Los datos de tarjeta se introducen únicamente en Checkout de Stripe.

## Evidencia real del sandbox

Se completó Checkout desde Chromium con una tarjeta de prueba. El pago fue de 100 EUR: comisión de aplicación de 10 EUR, saldo del partner de 90 EUR y coste Stripe observado de 3,40 EUR. Ese coste corresponde a esta operación de prueba; no es una tarifa prometida.

Se recibió un webhook firmado. La devolución de 30 EUR dejó 63 EUR en el reparto del partner. Repetir la petición con la misma clave devolvió el mismo ID de reembolso sin duplicar el movimiento. La devolución posterior de 70 EUR dejó 100 EUR devueltos, transferencia totalmente revertida y 10 EUR de comisión de aplicación devueltos. El neto de plataforma quedó en −3,40 EUR por el coste procesado. Consultar el pago sin la cookie de su sesión devolvió 403.

Un segundo recorrido de 25 EUR verificó desde los botones del navegador Checkout, devolución parcial de 10 EUR y devolución de los 15 EUR restantes. El saldo final del partner quedó en cero.

Los IDs y cifras comprobados están en `SANDBOX_EVIDENCE.json`. No contiene claves, cookies ni datos de tarjeta. El destino usado es una cuenta Custom de prueba con transfers activa. El alta Express no está validada: su formulario mostró un CAPTCHA y se detuvo esa vía. No se ha probado producción ni un payout bancario.

## Configuración y publicación

Las variables se administran en Vercel, fuera del repositorio: STRIPE_SECRET_KEY, STRIPE_PARTNER_ACCOUNT_ID, STRIPE_WEBHOOK_SECRET, DEMO_SESSION_SECRET y APP_URL. El webhook apunta a `/api/webhook` y escucha checkout.session.completed, payment_intent.succeeded y charge.refunded. La autorización OAuth del CLI no se exporta al servidor.

Empaquetar `api/`, requirements.txt y vercel.json del backend junto a `public/` con index.html, styles.css, app.mjs, ledger.mjs, stripe-ui.mjs y robots.txt. Excluir .env*, tests, __pycache__, logs y credenciales. Reutilizar el proyecto Vercel existente. La carpeta de publicación privada está fuera del repositorio.

## Verificación y límites

- 8 pruebas Node del registro simulado.
- 9 pruebas pytest del backend, incluidas compatibilidad con el SDK instalado y estado de devolución completa.
- Checkout público y consultas/devoluciones reales en sandbox, con comprobación de idempotencia y pertenencia.

Stripe es la fuente de verdad monetaria; la demo no implementa un ledger persistente de negocio ni efectos secundarios productivos para los webhooks. Para partners productivos quedan identidad y tenant, onboarding real, persistencia auditable, reconciliación, límites y responsabilidades. Billing recurrente, permisos, emails y operaciones se presentan como trabajo propuesto, no como integración ya completada.
