# Partners Lab

Demo de Roberto para explorar cobros de un SaaS B2B y reparto a partners con Stripe Connect Destination Charges.

**Demo:** https://partners-lab-roberto.vercel.app

## Qué puedes probar

- Un cobro en Checkout de Stripe sandbox, con comisión de plataforma y transferencia a una cuenta conectada de prueba.
- Consultar el reparto y devolver parcial o totalmente un pago de tu sesión.
- Un simulador independiente para explorar rechazos, altas ficticias y eventos repetidos.
- El trabajo propuesto para lanzar el producto: acceso, facturación recurrente, emails, despliegue y seguimiento.

No se mueve dinero real. Usa únicamente los datos de prueba que indica la interfaz. El cobro se introduce en Checkout de Stripe, nunca en esta aplicación.

## Diseño

Referencia creada con Imagegen (modo builtin) e implementada con Grok 4.6: [imagen](docs/design/stripe-reference-v2.png) y [prompt](docs/design/imagegen-prompt-v2.txt). La interfaz usa HTML/CSS nativos y conserva la integración sandbox.

## Código

- `demos/partner-payments/`: HTML, CSS y JavaScript; sin framework de frontend.
- `demos/partner-payments-stripe/`: FastAPI y SDK Python de Stripe.
- `demos/partner-payments/DEPLOYMENT.md`: alcance y evidencia del sandbox.
- `.agent/qa/`: informe de QA y evidencias visuales de esta revisión.

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

## Ejecutar o desplegar

```bash
python3 scripts/prepare_release.py
cd .build
npx vercel dev
```

Para conectar tu propio sandbox, configura en Vercel o en `.build/.env.local` las variables descritas en `.env.example`. Usa una cuenta Connect TEST con `transfers` activa. Configura el webhook `/api/webhook` para `checkout.session.completed`, `payment_intent.succeeded` y `charge.refunded`. Ajusta APP_URL al origen público o local exacto. Para publicar tu copia, ejecuta `npx vercel --prod` desde `.build`.

La configuración publicada y sus credenciales pertenecen a la demo de Roberto y no se incluyen en este repositorio. Sin configuración, la interfaz conserva el simulador y no habilita Checkout.

## Límites

La integración comprobada usa una cuenta Custom de prueba. No prueba onboarding Express, payouts bancarios ni operación en producción. Stripe es la fuente de verdad financiera de esta demo; aún no existe un ledger de negocio persistente, identidad por tenant ni reconciliación productiva. Billing recurrente y las demás capacidades de lanzamiento son trabajo propuesto. Este código permite revisar el recorrido y la integración, no desplegar un marketplace productivo sin ese trabajo adicional.
