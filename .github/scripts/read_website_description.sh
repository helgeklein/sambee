#!/usr/bin/env bash

set -euo pipefail

readonly WEBSITE_PARAMS_FILE="website/config/_default/params.toml"

if [[ ! -f "$WEBSITE_PARAMS_FILE" ]]; then
  echo "Website params file not found: $WEBSITE_PARAMS_FILE" >&2
  exit 1
fi

python3 - "$WEBSITE_PARAMS_FILE" <<'PY'
from pathlib import Path
import sys
import tomllib

params_path = Path(sys.argv[1])
with params_path.open("rb") as handle:
    params = tomllib.load(handle)

description = str(params.get("description", "")).strip()
if not description:
    raise SystemExit(f"Missing description in {params_path}")

print(description)
PY
