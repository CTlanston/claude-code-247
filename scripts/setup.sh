#!/usr/bin/env bash
set -euo pipefail

# 一键初始化：拉镜像、建状态目录、起服务
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "[setup] copying .env.example -> .env"
  cp .env.example .env
  echo "请先编辑 .env 填入 ANTHROPIC_API_KEY 和 GITHUB_TOKEN，再次运行本脚本。"
  exit 1
fi

mkdir -p state workspaces

echo "[setup] building runner image"
docker compose --profile build build runner

echo "[setup] building orchestrator image"
docker compose build orchestrator

echo "[setup] starting redis + orchestrator"
docker compose up -d redis orchestrator

echo "[setup] tailing orchestrator logs (Ctrl-C 退出，不影响后台)"
docker compose logs -f orchestrator
