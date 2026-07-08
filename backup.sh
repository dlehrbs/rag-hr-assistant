#!/bin/bash
# DB 자동 백업 스크립트 — 매일 새벽 2시 실행 (cron 등록)
# 보관: 최근 7일치, 오래된 것 자동 삭제
#
# cron 등록 방법:
#   crontab -e
#   0 2 * * * /path/to/chatbot_widget/backup.sh >> /path/to/chatbot_widget/logs/backup.log 2>&1

# 스크립트 위치 기준 상대경로 사용 (절대경로 하드코딩 금지)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT="$SCRIPT_DIR/backups"
SOURCE="$SCRIPT_DIR/data/databases"
DATE=$(date +"%Y-%m-%d_%H%M")
DEST="$BACKUP_ROOT/$DATE"

mkdir -p "$DEST"
cp -r "$SOURCE"/. "$DEST/"

# 7일 이상 된 백업 삭제
find "$BACKUP_ROOT" -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +

echo "[$DATE] 백업 완료: $DEST"
