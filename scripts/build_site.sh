#!/usr/bin/env bash
# 組出 GitHub Pages 要公開的靜態網站（預設輸出到 _site/）。
#
# 只複製瀏覽器執行時需要的檔案；測試、eval、Python 題庫腳本、api/（Vercel 專用）、
# CLAUDE.md 等一律不公開。deploy.yml 與 e2e 測試共用此腳本，確保測的就是要部署的內容。
# 新增前端執行期檔案時，必須同步加進 SITE_FILES / SITE_DIRS，否則 e2e 會失敗。
set -euo pipefail

OUT="${1:-_site}"
SITE_FILES=(index.html .nojekyll questions.json manifest.webmanifest sw.js)
SITE_DIRS=(css js assets)

cd "$(dirname "$0")/.."
rm -rf "$OUT"
mkdir -p "$OUT"
for f in "${SITE_FILES[@]}"; do cp "$f" "$OUT/"; done
for d in "${SITE_DIRS[@]}"; do cp -R "$d" "$OUT/"; done

# 防呆：不得把金鑰或非網站檔案帶進輸出。
for forbidden in api tests eval CLAUDE.md AGENTS.md generate_questions.py package.json; do
  if [ -e "$OUT/$forbidden" ]; then
    echo "build_site: $forbidden 不應出現在 $OUT" >&2
    exit 1
  fi
done
echo "build_site: 已輸出 $(find "$OUT" -type f | wc -l | tr -d ' ') 個檔案到 $OUT"
