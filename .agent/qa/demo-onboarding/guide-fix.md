# Corrección de onboarding

- El test enfoca `#tab-partners` antes de enviar `Home`; la semántica de teclado de la app no cambia.
- El launcher usa la resolución de Playwright de `reset.browser.test.mjs`, sin fijar `/usr/bin/google-chrome`.
- La guía ya no afirma que se seleccionó una cuenta de ejemplo ni exige activar Express: indica revisar el destino/estado mostrado y continuar si hace falta.
- El test comprueba navegación local, Express, checkout y ausencia de esos claims; también guarda `desktop-1440-onboarding.png` y `mobile-390-onboarding.png`.

Verificación: ejecutar `node --test demos/partner-payments/tests/onboarding.browser.test.mjs`. Si Chromium no arranca en el entorno restringido, el test queda omitido y las capturas no se consideran evidencia de ejecución.
