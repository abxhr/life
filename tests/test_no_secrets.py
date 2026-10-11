"""Nothing key- or token-shaped may live in the repo (keys belong in Settings, stored encrypted, or in .env which git ignores)."""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".venv", "data", "node_modules", ".git", ".agents", ".claude", "__pycache__", "vendor", "shots", "splash", "screens"}
PATTERNS = {"OpenAI/Anthropic key": r"sk-[A-Za-z0-9_-]{20,}", "Life capture token": r"lc_[A-Za-z0-9_-]{20,}", "Telegram bot token": r"\b[0-9]{8,10}:[A-Za-z0-9_-]{30,}", "GitHub token": r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}",
            "AWS key": r"AKIA[0-9A-Z]{16}", "Google key": r"AIza[0-9A-Za-z_-]{30,}", "Slack token": r"xox[baprs]-[A-Za-z0-9-]{10,}", "private key block": r"-----BEGIN [A-Z ]*PRIVATE KEY-----"}


def test_no_secrets_in_the_project_files():
    hits = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith((".png", ".jpg", ".ico", ".woff2", ".zip", ".gz", ".db", ".pyc", ".svg")) or f == ".env":
                continue
            p = os.path.join(base, f)
            try: text = open(p, encoding="utf8", errors="ignore").read()
            except OSError: continue
            for name, rx in PATTERNS.items():
                m = re.search(rx, text)
                if m: hits.append(f"{os.path.relpath(p, ROOT)}: {name}")
    assert not hits, hits


def test_env_file_and_data_are_ignored_by_git():
    ig = open(os.path.join(ROOT, ".gitignore"), encoding="utf8").read().split()
    for must in (".env", "data/", ".venv/", "*.pem", "*.key"):
        assert must in ig, must
