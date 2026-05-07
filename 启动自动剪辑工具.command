#!/bin/zsh

cd "/Users/xingzengji/Documents/New project 3" || exit 1

echo "正在启动自动剪辑工具..."
echo "访问地址：http://127.0.0.1:4173"
echo ""

open "http://127.0.0.1:4173"

pnpm dev
