#!/bin/bash
# WebAI2API 后台启动脚本
# 用法: ./start.sh
# 退出终端后继续运行

cd "$(dirname "$0")"

# 检查是否在运行
if pgrep -f "supervisor.js" > /dev/null 2>&1; then
    echo "检测到服务正在运行，正在停止..."
    pkill -f "supervisor.js" 2>/dev/null
    sleep 3
fi

nohup npm start -- -xvfb -vnc > webai2api.log 2>&1 &

echo "WebAI2API 已启动 (PID: $!)"
echo "日志文件: $(pwd)/webai2api.log"
echo "VNC 端口: 5900"
echo "API 端口: 9330"

sleep 3
if curl -s http://localhost:9330/v1/models -H "Authorization: Bearer $(grep '^server:' data/config.yaml -A 2 | grep auth | awk '{print $2}')" > /dev/null 2>&1; then
    echo "✓ 服务已就绪"
else
    echo "⚠ 服务启动中，请稍后..."
fi
