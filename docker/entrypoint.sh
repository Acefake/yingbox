#!/bin/sh
# 影盒片库服务的容器入口（ADR-0010）：服务进程永远不以 root 运行。
#
# - 以 root 启动（默认）：把配置目录（YINGBOX_DATA_DIR，默认 /config）与缓存目录（YINGBOX_CACHE_DIR，默认 /cache）
#   里属主不是 PUID:PGID 的条目改过去（chown -h，不跟随符号链接；属主已经对的不动，重启不重复遍历改权限），
#   再用 setpriv 换成 PUID:PGID 并清掉附加组，exec 服务。PUID / PGID 默认 1000（镜像里 node 用户）。
# - 不以 root 启动（compose 的 user: 或 docker run --user）：不改属主，原样 exec 服务；PUID / PGID 不起作用。
# - 片库目录（/media）只读挂载，从不改它的属主：服务用户要能读到媒体文件，PUID / PGID 设成媒体文件的属主即可。
set -eu

if [ "$(id -u)" != 0 ]; then
  exec "$@"
fi

puid="${PUID:-1000}"
pgid="${PGID:-1000}"
for value in "$puid" "$pgid"; do
  case "$value" in
    '' | *[!0-9]*)
      echo "[yingbox] PUID / PGID 应为数字：$value" >&2
      exit 64
      ;;
  esac
done
if [ "$puid" -eq 0 ] || [ "$pgid" -eq 0 ]; then
  echo "[yingbox] 不以 root 运行服务：PUID / PGID 不能是 0" >&2
  exit 64
fi

for dir in "${YINGBOX_DATA_DIR:-/config}" "${YINGBOX_CACHE_DIR:-/cache}"; do
  mkdir -p "$dir"
  find "$dir" \( ! -user "$puid" -o ! -group "$pgid" \) -exec chown -h "$puid:$pgid" {} +
done

exec setpriv --reuid="$puid" --regid="$pgid" --clear-groups -- "$@"
