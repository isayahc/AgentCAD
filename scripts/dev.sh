#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

pick_python() {
  local candidates=(
    "$BACKEND_DIR/.venv/bin/python"
    "$ROOT_DIR/.venv/bin/python"
    "python3"
  )

  for candidate in "${candidates[@]}"; do
    if ! command -v "$candidate" >/dev/null 2>&1; then
      continue
    fi

    if "$candidate" -c "import uvicorn, cadquery" >/dev/null 2>&1; then
      printf "%s" "$candidate"
      return 0
    fi
  done

  return 1
}

if ! PYTHON_BIN="$(pick_python)"; then
  echo "Could not find a Python environment with both 'uvicorn' and 'cadquery'."
  echo "Install backend deps into one env, for example:"
  echo "  python3 -m pip install -r requirements.txt"
  exit 1
fi

echo "Using Python: $PYTHON_BIN"

cleanup() {
  echo ""
  echo "Stopping frontend and backend..."
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait || true
}

trap cleanup EXIT INT TERM

echo "Starting backend on http://localhost:8000 ..."
"$PYTHON_BIN" -m uvicorn app:app --reload --reload-dir "$BACKEND_DIR/src" --host 0.0.0.0 --port 8000 --app-dir "$BACKEND_DIR/src" &
BACKEND_PID=$!

echo "Starting frontend on http://localhost:3000 ..."
(
  cd "$FRONTEND_DIR"
  npm run dev
) &
FRONTEND_PID=$!

wait -n
