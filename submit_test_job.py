from __future__ import annotations

import argparse
import json
import os
import urllib.request
from pathlib import Path


def read_text(path: Path) -> dict[str, str]:
    return {"name": path.name, "text": path.read_text()}


def post_json(url: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Submit a tiny conDitar GUI backend test job.")
    parser.add_argument("--url", default="http://127.0.0.1:4173/api/jobs")
    parser.add_argument("--target", choices=["local_cpu", "slurm_gpu"], default="slurm_gpu")
    parser.add_argument("--examples", default="/path/to/conDitar-dev/examples")
    parser.add_argument("--slurm-account", default=os.environ.get("CONDITAR_SLURM_ACCOUNT", ""))
    parser.add_argument("--no-vina", action="store_true")
    args = parser.parse_args()

    examples = Path(args.examples)
    payload = {
        "target": args.target,
        "mode": "reference",
        "example_id": "4aua-api-test",
        "pdb": read_text(examples / "4aua" / "4aua_protein.pdb"),
        "sdf": read_text(examples / "4aua" / "4aua_ligand.sdf"),
        "parameters": {
            "num_samples": 1,
            "batch_size": 1,
            "pocket_radius": 10,
        },
        "postprocess": {
            "vina": not args.no_vina,
            "vina_mode": "vina_score",
            "vina_exhaustiveness": "8",
            "vina_cpu": "4",
        },
        "slurm": {
            "account": args.slurm_account,
            "time": "04:00:00",
            "mem": "32G",
            "cpus": "4",
            "gpus": "1",
        },
    }
    response = post_json(args.url, payload)
    print(json.dumps(response, indent=2))
    job = response.get("job") or {}
    if job.get("id"):
        print()
        print(f"Job URL: {args.url.rsplit('/api/jobs', 1)[0]}/api/jobs/{job['id']}")
        print(f"Job folder: job_data/jobs/{job['id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
