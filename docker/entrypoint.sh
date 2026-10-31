#!/bin/sh
# 影盒片库服务的容器入口（ADR-0010）：服务进程永远不以 root 运行。
#
# - 以 root 启动（默认）：把配置目录（YINGBOX_DATA_DIR，默认 /config）与缓存目录（YINGBOX_CACHE_DIR，默认 /cache）
#   里属主不是 PUID:PGID 的条目改过去（chown -h，不跟随符号链接；属主已经对的不动，重启不重复遍历改权限），
#   再用 setpriv 换成 PUID:PGID。附加组只保留 PGID，以及媒体根目录自己的所属组（跳过 root 组），然后 exec 服务。
#   PUID / PGID 默认 1000（镜像里 node 用户）。
# - 不以 root 启动（compose 的 user: 或 docker run --user）：不改属主，原样 exec 服务；PUID / PGID 不起作用，也不会加入媒体目录的组。
# - 片库目录从不改属主。目录对所属组可读（如 750）而 PGID 不是这个组时，入口会把该组加进来。
#   权限是 700 且属主不是 PUID 时仍然读不到，需要把 PUID 设成属主。
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

# 在线板块的下载目录（YINGBOX_DOWNLOAD_DIR，默认 /downloads，ADR-0019）：只改目录本身的属主（-maxdepth 0），
# 不遍历里面已有的文件（它可能指向片库里的文件夹）。建不了或改不了属主（只读挂载、NFS root_squash 等）
# 只打警告、照常启动，由服务在下载时报错：下载目录不影响片库本身
download_dir="${YINGBOX_DOWNLOAD_DIR:-/downloads}"
if mkdir -p "$download_dir" 2>/dev/null; then
  find "$download_dir" -maxdepth 0 \( ! -user "$puid" -o ! -group "$pgid" \) -exec chown -h "$puid:$pgid" {} + 2>/dev/null \
    || echo "[yingbox] 无法把下载目录 $download_dir 的属主改成 $puid:$pgid，在线下载可能写不进去" >&2
else
  echo "[yingbox] 无法创建下载目录 $download_dir，在线下载不可用" >&2
fi

# 媒体目录的所属组加进附加组（跳过 root 组）。
# 目录是 750、PGID 又不是这个组时，只改 uid 仍然读不到；用户把目录挂进来就是要给服务读。
# 700 且属主不是 PUID 时附加组帮不上忙，启动日志会说明。
media_groups="$pgid"
old_ifs=$IFS
IFS=':'
for root in ${YINGBOX_MEDIA_ROOTS:-/media}; do
  [ -d "$root" ] || continue
  gid=$(stat -c '%g' "$root" 2>/dev/null || stat -f '%g' "$root" 2>/dev/null || true)
  case "$gid" in
    '' | 0 | "$pgid") continue ;;
  esac
  case ",$media_groups," in
    *",$gid,"*) ;;
    *) media_groups="$media_groups,$gid" ;;
  esac
done
IFS=$old_ifs
if [ "$media_groups" != "$pgid" ]; then
  echo "[yingbox] 媒体目录所属组加入服务进程：$media_groups" >&2
fi

exec setpriv --reuid="$puid" --regid="$pgid" --clear-groups --groups="$media_groups" -- "$@"
