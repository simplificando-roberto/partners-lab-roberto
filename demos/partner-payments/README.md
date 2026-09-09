# Roberto / Partners Lab — demo de cobros

Demo publicada: https://partners-lab-roberto.vercel.app

Frontend estático con módulos ES, servido por HTTP junto al backend de `../partner-payments-stripe/`. Abrir index.html como file:// puede bloquear los módulos por la política del navegador.

## Recorridos

- **Stripe sandbox:** Checkout, reparto al partner, consulta de estado y devoluciones mediante la API. Solo aparece cuando `/api/config` confirma que hay configuración TEST y partner.
- **Simulador local:** cobro, rechazo, alta ficticia, reembolsos y eventos repetidos. No llama a Stripe. Su coste es ilustrativo.
- **Lanzamiento:** trabajo propuesto alrededor del producto, no integraciones productivas ya terminadas.

`ledger.mjs` mantiene aislada la contabilidad simulada. `stripe-ui.mjs` consume la API sin reutilizar esos saldos.

## Comprobación

```bash
node --test demos/partner-payments/tests/*.test.mjs
```

Consulta `DEPLOYMENT.md` y `SANDBOX_EVIDENCE.json` para la configuración, la prueba real de sandbox y los límites pendientes para producción. No incluir credenciales en este directorio.
