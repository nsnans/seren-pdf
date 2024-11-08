#!/bin/bash

# 检查是否提供了目录路径
if [ -z "$1" ]; then
  echo "请提供一个目录路径。"
  exit 1
fi

DIRECTORY=$1

# 检查目录是否存在
if [ ! -d "$DIRECTORY" ]; then
  echo "目录不存在: $DIRECTORY"
  exit 1
fi

# 遍历目录中的所有 .js 文件并重命名为 .ts
for file in "$DIRECTORY"/*.js; do
  if [ -f "$file" ]; then
    mv "$file" "${file%.js}.ts"
    echo "已重命名: $file -> ${file%.js}.ts"
  else
    echo "没有找到任何 .js 文件。"
  fi
done

echo "重命名完成。"
