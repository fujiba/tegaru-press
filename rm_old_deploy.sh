#!/bin/bash
set -e # コマンドがエラーになったらすぐに終了する
echo "📦 古いデプロイメントを削除しています..."
clasp deployments | tail -n +2 | awk 'NR > 5 {print $2}' | xargs -n 1 clasp undeploy
