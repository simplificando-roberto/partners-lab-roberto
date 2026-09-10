# Partners Lab

Demo pública de Roberto para probar cobros de un SaaS B2B y reparto a partners con Stripe Connect Destination Charges.

**Abrir la demo:** https://partners-lab-roberto.vercel.app

Todo ocurre en Stripe TEST. No se mueve dinero real.

## Para quien llega a la demo

Hay dos recorridos:

- **Probar con el partner de ejemplo.** Abre Cobros, acepta el importe y la comisión mostrados y pulsa `Probar pago con Stripe`. Checkout se abre en Stripe. Usa la tarjeta de prueba `4242 4242 4242 4242`, una fecha futura y CVC `123`.
- **Dar de alta tu propio partner de prueba.** En Partners pulsa el alta Express y completa el formulario alojado por Stripe con datos TEST. Al volver, la demo consulta el estado de la cuenta. El regreso por sí solo no confirma que esté lista: Checkout solo se habilita cuando `transfers` aparece activo.

La guía paso a paso está en [docs/demo-guide.md](docs/demo-guide.md). Explica el reparto bruto, la comisión, el coste de Stripe, el neto y lo que ocurre al devolver un pago.

El botón `Reiniciar demo` crea una sesión de navegador nueva, elimina la asociación Express de esa sesión y borra la simulación local. No elimina cuentas ni pagos de Stripe ni hace reembolsos. Si quieres devolver un pago, hazlo antes de reiniciar.

## Código

- `demos/partner-payments/`: HTML, CSS y JavaScript del frontend, sin framework.
- `demos/partner-payments-stripe/`: FastAPI y SDK Python de Stripe.
- `docs/demo-guide.md`: recorrido público, estados y límites.
- `docs/express/implementation.md`: contrato técnico del alta Express.
- `docs/reset-demo.md`: comportamiento del reinicio de sesión.

La pestaña `Lanzamiento` describe servicios que propondríamos alrededor del producto, como acceso, billing recurrente, emails, operaciones y seguimiento. No son integraciones terminadas de esta demo.

## Ejecutar las pruebas

Requisitos: Node.js 20+ y Python 3.12.

```bash
python3 -m venv .venv
.venv/bin/pip install -r demos/partner-payments-stripe/requirements.txt pytest httpx
npm install --no-save playwright
npx playwright install chromium
node --test demos/partner-payments/tests/*.test.mjs
.venv/bin/python -m pytest -q demos/partner-payments-stripe/tests
```

## Ejecutar una copia local o preparar una publicación

```bash
python3 scripts/prepare_release.py
cd .build
npx vercel dev
```

Para conectar una copia a tu propio sandbox, configura en Vercel o en `.build/.env.local` las variables de `.env.example`. Usa una clave TEST con permisos para crear y consultar cuentas Connect, un partner Custom TEST con `transfers` activo, `APP_URL` con el origen exacto y un `DEMO_SESSION_SECRET` aleatorio de al menos 32 caracteres. Configura el webhook de plataforma `/api/webhook` para `checkout.session.completed`, `payment_intent.succeeded` y `charge.refunded`, y un endpoint Connect separado para `account.updated` con `STRIPE_CONNECT_WEBHOOK_SECRET`. Para publicar tu copia, ejecuta `npx vercel --prod` desde `.build`.

Las credenciales de la demo publicada no están en este repositorio. Sin configuración, la interfaz conserva la simulación local y deja Checkout deshabilitado. No compartas claves en issues ni en el código.

## Alcance y límites

La integración usa Checkout TEST, Destination Charges, comisión de aplicación, devoluciones con reversión de transferencia y alta Express alojada por Stripe. La cuenta Express queda asociada a una sesión firmada de navegador durante una hora y no se reutiliza desde otra sesión. Stripe es la fuente de verdad de los importes y estados.

La demo no tiene login, identidad por tenant, ledger de negocio persistente ni reconciliación productiva. No prueba payouts bancarios ni procesa dinero real. Las comisiones de Stripe dependen de la operación y pueden quedar pendientes o no devolverse. El simulador local es independiente y solo sirve para explorar estados; no crea objetos en Stripe.

La interfaz conserva el diseño estilo Stripe y la integración sandbox. La referencia visual está en [docs/design/stripe-reference-v2.png](docs/design/stripe-reference-v2.png), con su [prompt](docs/design/imagegen-prompt-v2.txt). La evidencia de pruebas y contratos internos está enlazada desde la documentación técnica.
