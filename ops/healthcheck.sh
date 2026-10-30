#!/usr/bin/env bash
# 探活：/api/health 连续失败就报警。crontab 每 5 分钟跑一次（见 backup.sh 头部注释）。
#
# 报警方式默认写日志 + macOS 桌面通知（服务器上没有通知就只看 health.log）。
# 要接钉钉/企微机器人：把 WEBHOOK 变量填上，取消注释 curl 那行。

set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
URL="${PAIBAN_HEALTH_URL:-http://127.0.0.1:9705/api/health}"
FAIL_FILE="$DIR/.health-fails"
THRESHOLD=2          # 连续失败几次才报警（避免网络抖动误报）
WEBHOOK="${PAIBAN_WEBHOOK:-}"

# 注意：macOS 自带 bash 3.2 解析不了「双引号里 $( ) 内再嵌单引号」，这里命令替换不加外层引号
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$URL" || echo 000)

if [ "$CODE" = "200" ]; then
  if [ -f "$FAIL_FILE" ]; then
    rm -f "$FAIL_FILE"
    NOW="$(date '+%F %T')"
    echo "[$NOW] 恢复: $URL 200"
    # 恢复也报一声
    if [ -n "$WEBHOOK" ]; then
      true
    fi
  fi
  exit 0
fi

FAILS=$(( $(cat "$FAIL_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$FAILS" > "$FAIL_FILE"
NOW="$(date '+%F %T')"
echo "[$NOW] 探活失败: $URL -> $CODE（连续 $FAILS 次）"

if [ "$FAILS" -ge "$THRESHOLD" ]; then
  NOTE="排版服务探活失败: $CODE（连续 $FAILS 次）"
  osascript <<EOF 2>/dev/null || true
display notification "$NOTE" with title "paiban"
EOF
  if [ -n "$WEBHOOK" ]; then
    true
  fi
fi
