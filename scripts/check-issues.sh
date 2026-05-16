#!/bin/bash

# 重构后问题检查脚本
# 用法: bash scripts/check-issues.sh

echo "========================================="
echo "  重构后问题检查"
echo "========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 错误计数
ERRORS=0
WARNINGS=0

# 1. TypeScript 类型检查
echo "1. 运行 TypeScript 类型检查..."
echo "-----------------------------------------"
if pnpm typecheck:web 2>&1 | grep -q "error TS"; then
    echo -e "${RED}❌ 发现 TypeScript 错误${NC}"
    pnpm typecheck:web 2>&1 | grep "error TS" | head -20
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ TypeScript 类型检查通过${NC}"
fi
echo ""

# 2. ESLint 检查（如果配置正常）
echo "2. 运行 ESLint 代码规范检查..."
echo "-----------------------------------------"
if pnpm lint 2>&1 | grep -q "error\|warning"; then
    echo -e "${YELLOW}⚠️ 发现 ESLint 问题${NC}"
    pnpm lint 2>&1 | grep "error\|warning" | head -10
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "${GREEN}✅ ESLint 检查通过${NC}"
fi
echo ""

# 3. 检查未使用的导入（简单检查）
echo "3. 检查未使用的导入..."
echo "-----------------------------------------"
UNUSED_IMPORTS=$(grep -r "^import.*from" src/renderer/src --include="*.ts" --include="*.vue" 2>/dev/null | \
    grep -v "type " | \
    grep -v "// " | \
    wc -l)
echo "发现 $UNUSED_IMPORTS 个导入语句"
echo ""

# 4. 检查硬编码的 URL
echo "4. 检查硬编码的 URL..."
echo "-----------------------------------------"
HARDCODED_URLS=$(grep -r "http://localhost" src/renderer/src --include="*.ts" --include="*.vue" 2>/dev/null | wc -l)
if [ "$HARDCODED_URLS" -gt 0 ]; then
    echo -e "${YELLOW}⚠️ 发现 $HARDCODED_URLS 个硬编码的 localhost URL${NC}"
    grep -r "http://localhost" src/renderer/src --include="*.ts" --include="*.vue" 2>/dev/null | head -5
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "${GREEN}✅ 没有硬编码的 URL${NC}"
fi
echo ""

# 5. 检查 console.log 语句
echo "5. 检查 console.log 语句..."
echo "-----------------------------------------"
CONSOLE_LOGS=$(grep -r "console\.log" src/renderer/src --include="*.ts" --include="*.vue" 2>/dev/null | wc -l)
echo "发现 $CONSOLE_LOGS 个 console.log 语句"
echo ""

# 总结
echo "========================================="
echo "  检查完成"
echo "========================================="
echo ""
echo "错误: $ERRORS"
echo "警告: $WARNINGS"
echo ""

if [ $ERRORS -gt 0 ]; then
    echo -e "${RED}❌ 发现错误，需要修复后才能提交${NC}"
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠️ 发现警告，建议修复${NC}"
    exit 0
else
    echo -e "${GREEN}✅ 所有检查通过${NC}"
    exit 0
fi
