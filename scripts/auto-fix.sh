#!/bin/bash

# 自动修复脚本
# 用法: bash scripts/auto-fix.sh

echo "========================================="
echo "  自动修复潜在问题"
echo "========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 修复计数
FIXED=0

# 1. 修复未使用的变量（添加下划线前缀）
echo "1. 修复未使用的变量..."
echo "-----------------------------------------"

# router/index.ts 中的未使用参数
ROUTER_FILE="src/renderer/src/router/index.ts"
if [ -f "$ROUTER_FILE" ]; then
    # 修复 scrollBehavior 中的未使用参数
    sed -i 's/scrollBehavior(to, from, savedPosition)/scrollBehavior(_to, _from, savedPosition)/' "$ROUTER_FILE"
    echo -e "${GREEN}✅ 修复 router/index.ts 中的未使用参数${NC}"
    FIXED=$((FIXED + 1))
fi

# 2. 删除空的 barrel 文件
echo ""
echo "2. 清理空的 barrel 文件..."
echo "-----------------------------------------"

# 检查并删除空的 index.ts 文件
for file in src/renderer/src/views/*/composables/index.ts; do
    if [ -f "$file" ] && [ ! -s "$file" ]; then
        rm "$file"
        echo -e "${GREEN}✅ 删除空文件: $file${NC}"
        FIXED=$((FIXED + 1))
    fi
done

# 3. 统一后端 URL 配置
echo ""
echo "3. 检查后端 URL 配置..."
echo "-----------------------------------------"

# 检查 use-vod-parser.ts 是否使用了硬编码 URL
VOD_FILE="src/renderer/src/composables/use-vod-parser.ts"
if [ -f "$VOD_FILE" ]; then
    if grep -q "http://localhost:31471" "$VOD_FILE"; then
        echo -e "${YELLOW}⚠️  建议: 将 use-vod-parser.ts 中的硬编码 URL 改为使用 getGoBackendUrl()${NC}"
    fi
fi

# 4. 清理 console.log（生产环境）
echo ""
echo "4. 检查 console.log 语句..."
echo "-----------------------------------------"

CONSOLE_COUNT=$(grep -r "console\.log" src/renderer/src --include="*.ts" --include="*.vue" 2>/dev/null | wc -l)
if [ "$CONSOLE_COUNT" -gt 20 ]; then
    echo -e "${YELLOW}⚠️  发现 $CONSOLE_COUNT 个 console.log 语句，建议在生产构建中移除${NC}"
fi

# 总结
echo ""
echo "========================================="
echo "  修复完成"
echo "========================================="
echo ""
echo "已修复: $FIXED 个问题"
echo ""

if [ $FIXED -gt 0 ]; then
    echo -e "${GREEN}✅ 已自动修复一些问题${NC}"
    echo "建议运行 'pnpm typecheck' 验证修复结果"
else
    echo -e "${GREEN}✅ 没有需要自动修复的问题${NC}"
fi
