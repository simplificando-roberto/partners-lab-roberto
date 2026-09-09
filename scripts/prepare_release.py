"""Build an isolated Vercel directory without credentials or repository metadata."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
out = root / ".build"
backend = root / "demos/partner-payments-stripe"
frontend = root / "demos/partner-payments"
out.mkdir(exist_ok=True)
shutil.copytree(backend / "api", out / "api", dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
for name in ("requirements.txt", "vercel.json"):
    shutil.copy2(backend / name, out / name)
(out / "public").mkdir(exist_ok=True)
for name in ("index.html", "styles.css", "app.mjs", "ledger.mjs", "stripe-ui.mjs"):
    shutil.copy2(frontend / name, out / "public" / name)
(out / "public/robots.txt").write_text("User-agent: *\nDisallow: /\n")
(out / ".vercelignore").write_text(".env*\n.git\n**/__pycache__/**\n**/*.pyc\ntests\n*.log\n")
print("Prepared .build/ with public frontend and test-only API.")
