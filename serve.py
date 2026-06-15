"""Serve the conDitar frontend preview with no project dependencies."""
from __future__ import annotations

import argparse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve conDitar Studio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), SimpleHTTPRequestHandler)
    print(f"conDitar Studio: http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
