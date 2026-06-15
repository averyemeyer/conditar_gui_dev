"""Serve the conDitar frontend preview with no project dependencies."""
from __future__ import annotations

import argparse
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import threading
import webbrowser


PROJECT_ROOT = Path(__file__).resolve().parent
REQUIRED_PATHS = (
    "index.html",
    "src/app.js",
    "4aua/4aua_protein.pdb",
    "4aua/4aua_ligand.sdf",
    "xxxx/xxxx_pocket.pdb",
    "conditar_results/4aua",
    "conditar_results/xxxx",
)


def validate_project() -> None:
    missing = [path for path in REQUIRED_PATHS if not (PROJECT_ROOT / path).exists()]
    if missing:
        formatted = "\n".join(f"  - {path}" for path in missing)
        raise SystemExit(f"Required demo files are missing:\n{formatted}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve conDitar Studio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--open", action="store_true", help="Open the GUI in the default browser")
    args = parser.parse_args()
    validate_project()
    handler = partial(
        SimpleHTTPRequestHandler,
        directory=str(PROJECT_ROOT),
    )
    server = ThreadingHTTPServer((args.host, args.port), handler)
    url = f"http://{args.host}:{args.port}"
    print(f"conDitar Studio: {url}")
    print("Press Ctrl+C to stop the server.")
    if args.open:
        threading.Timer(0.4, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
