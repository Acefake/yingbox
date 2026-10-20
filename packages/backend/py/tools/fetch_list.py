"""
抓取 MissAV 官方 sitemap, 输出视频番号列表 JSON 到 stdout。

用法:
  python tools/fetch_list.py                  # 全量: 拉取索引 + 全部分片(慢, 数分钟)
  python tools/fetch_list.py --limit 3        # 只抓前 3 个 items 分片(开发用)
  python tools/fetch_list.py --max 5000       # 最多输出 5000 条
  python tools/fetch_list.py --cache DIR      # 分片落盘缓存, 二次运行跳过已缓存分片

输出: {"success": true, "total": N, "items": [{"avid": "...", "dm": "...", "url": "...", "lastmod": "..."}]}
环境变量:
  HTTPS_PROXY / HTTP_PROXY  走代理(与现有脚本一致)
"""
import io
import json
import os
import re
import sys
import time
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

SITEMAP_INDEX = "https://missav.ai/sitemap.xml"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36"
LOC_RE = re.compile(r"<loc>\s*([^<\s]+?)\s*</loc>", re.I)
# URL 形如 https://missav.ws/dm32/qmill-001 或 /dm32/cn/xxx
ITEM_RE = re.compile(r"/(?:dm(\d+)/)?(?:[a-z]{2}/)?([a-z0-9][a-z0-9\-]{1,79})/?$", re.I)


def fetch(url: str, timeout: int = 120) -> str:
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or os.environ.get("HTTP_PROXY")
    handlers = []
    if proxy:
        handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        handlers.append(handler)
    opener = urllib.request.build_opener(*handlers) if handlers else urllib.request.build_opener()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with opener.open(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def parse_args(argv):
    args = {"limit": None, "max": None, "cache": None}
    i = 0
    while i < len(argv):
        if argv[i] == "--limit" and i + 1 < len(argv):
            args["limit"] = int(argv[i + 1]); i += 2
        elif argv[i] == "--max" and i + 1 < len(argv):
            args["max"] = int(argv[i + 1]); i += 2
        elif argv[i] == "--cache" and i + 1 < len(argv):
            args["cache"] = argv[i + 1]; i += 2
        else:
            i += 1
    return args


def main():
    args = parse_args(sys.argv[1:])
    t0 = time.time()
    try:
        index_xml = fetch(SITEMAP_INDEX)
    except Exception as exc:
        print(json.dumps({"success": False, "error": f"fetch index failed: {exc}"}, ensure_ascii=False))
        return 1

    child_urls = LOC_RE.findall(index_xml)
    item_sitemaps = [u for u in child_urls if "_items_" in u]
    if not item_sitemaps:
        print(json.dumps({"success": False, "error": "no item sitemaps found"}, ensure_ascii=False))
        return 1

    if args["limit"]:
        item_sitemaps = item_sitemaps[: args["limit"]]

    cache_dir = args["cache"]
    items = []
    seen = set()
    for idx, sm_url in enumerate(item_sitemaps, 1):
        xml_text = None
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)
            cache_name = os.path.basename(sm_url).replace(".xml", ".json")
            cache_path = os.path.join(cache_dir, cache_name)
            if os.path.exists(cache_path):
                try:
                    with open(cache_path, "r", encoding="utf-8") as f:
                        xml_text = json.load(f)
                except Exception:
                    xml_text = None
        if xml_text is None:
            try:
                xml_text = fetch(sm_url)
            except Exception as exc:
                print(f"[fetch_list] sitemap {sm_url} failed: {exc}", file=sys.stderr)
                continue
            if cache_dir:
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(xml_text, f, ensure_ascii=False)

        # 先切出每个 <url> 块, 块内提取 loc + lastmod, 避免跨块误配
        for block in re.findall(r"<url>(.*?)</url>", xml_text, re.I | re.S):
            lm = re.search(r"<loc>\s*([^<\s]+?)\s*</loc>", block, re.I)
            if not lm:
                continue
            loc = lm.group(1)
            mm = ITEM_RE.search(loc)
            if not mm:
                continue
            lastmod_m = re.search(r"<lastmod>\s*([^<\s]+?)\s*</lastmod>", block, re.I)
            dm, avid = mm.group(1) or "", mm.group(2)
            key = avid.lower()
            if key in seen:
                continue
            seen.add(key)
            avid_lower = avid.lower()
            items.append({
                "avid": avid.upper(),
                "dm": dm,
                "url": loc,
                "poster": f"https://fourhoi.com/{avid_lower}/cover-t.jpg",
                "preview": f"https://fourhoi.com/{avid_lower}/preview.mp4",
                "lastmod": lastmod_m.group(1) if lastmod_m else "",
            })
            if args["max"] and len(items) >= args["max"]:
                break
        if args["max"] and len(items) >= args["max"]:
            break

    out = {"success": True, "total": len(items), "items": items,
           "sitemaps": len(item_sitemaps), "elapsed_ms": int((time.time() - t0) * 1000)}
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
