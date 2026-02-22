#!/bin/bash
# Bookworm Dashboard 一键更新脚本
# 用法: bash update.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Bookworm Dashboard 数据更新 ==="

# 1. 采集数据
echo "[1/3] 采集系统数据..."
node scripts/generate-data.js

# 2. 提交
echo "[2/3] 提交更新..."
git add docs/data.json
if git diff --cached --quiet; then
  echo "数据无变化，跳过提交"
else
  git commit -m "data: update dashboard $(date +%Y-%m-%d)"
fi

# 3. 推送
echo "[3/3] 推送到 GitHub..."
git push

echo "=== 完成! Dashboard 将在几秒后自动更新 ==="
