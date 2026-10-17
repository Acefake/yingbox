"""Resolve a page to HLS without downloading a video or writing library data."""
import html
import json
import os
import re
import socket
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError, URLError

PAGE_HOSTS = {"missav.ai", "missav.ws", "missav.com"}


class ResolveError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def page_url(value):
    value = value.strip()
    if re.fullmatch(r"[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*", value) and len(value) <= 120:
        return "https://missav.ai/cn/" + value.lower()
    parts = urlsplit(value)
    if (parts.scheme != "https" or parts.hostname not in PAGE_HOSTS
            or parts.port not in (None, 443) or parts.username or parts.password
            or not parts.path.strip("/") or len(value) > 2048):
        raise ResolveError("INVALID_INPUT", "请输入 MissAV 的 HTTPS 视频链接或番号")
    return parts._replace(fragment="").geturl()


def media_url(value):
    parts = urlsplit(value)
    return (parts.scheme == "https" and parts.hostname == "surrit.com"
            and parts.port in (None, 443) and not parts.username and not parts.password)


def extract_stream(page):
    # Direct sources and the packed UUID representation used by the existing downloader.
    decoded = html.unescape(page).replace(r"\/", "/")
    direct = re.search(r'https://surrit\.com/[^\s\x22\x27<>\\]+\.m3u8(?:\?[^\s\x22\x27<>\\]*)?', decoded)
    if direct:
        return direct.group(0)
    packed = re.search(r"m3u8\|([a-f0-9|]+)\|com\|surrit\|https\|video", decoded)
    if packed:
        uuid = "-".join(packed.group(1).split("|")[::-1])
        if re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", uuid):
            return f"https://surrit.com/{uuid}/playlist.m3u8"
    raise ResolveError("STREAM_NOT_FOUND", "页面未返回可识别的视频流，站点解析规则可能已变化")


def configured_proxy():
    proxy = os.environ.get("YINGBOX_PROXY_URL", "").strip()
    if proxy:
        return proxy
    try:
        config = json.loads((Path(__file__).parent / "cfg/configs.json").read_text(encoding="utf-8-sig"))
        return config.get("Proxy") or None
    except (OSError, ValueError):
        return None


def browser_page(url):
    """Reuse Yingbox's existing Electron browser-fetch service, if it is running.

    The discovery credential is only read in memory and never returned or logged.
    """
    discovery_path = Path(tempfile.gettempdir()) / "yingbox-browser-fetch.json"
    try:
        discovery = json.loads(discovery_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ResolveError("BROWSER_SERVICE_UNAVAILABLE", "MissAV 需要浏览器验证，但桌面浏览器服务未启动；请完全退出影盒，再启动桌面应用（仅启动 Go 后端不够）")
    try:
        endpoint = urlsplit(discovery["url"])
        if endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1" or not endpoint.port or endpoint.username or endpoint.password:
            raise ResolveError("BROWSER_SERVICE_UNAVAILABLE", "桌面浏览器服务配置无效，请完全重启影盒")
        request = Request(discovery["url"].rstrip("/") + "/fetch", data=json.dumps({"url": page_url(url), "waitMs": 20000}).encode(), headers={"Content-Type": "application/json", "x-yingbox-token": discovery["token"]})
        # Service may spend 30s loading and then 20s waiting for verification.
        with build_opener(ProxyHandler({})).open(request, timeout=60) as response:
            payload = response.read(8 * 1024 * 1024 + 1)
        if len(payload) > 8 * 1024 * 1024:
            raise ResolveError("BROWSER_RESPONSE_INVALID", "站点页面过大，无法解析")
        result = json.loads(payload)
        if result.get("ok") and isinstance(result.get("html"), str):
            return result["html"]
        reason = result.get("error", "")
        if reason == "challenge not passed":
            raise ResolveError("SITE_VERIFICATION_REQUIRED", "MissAV 的站点验证尚未通过；如果影盒右下角出现验证窗口，请在窗口中完成验证后重试。仅在外部浏览器打开站点不会同步影盒的验证状态")
        if reason == "browser load timeout":
            raise ResolveError("BROWSER_LOAD_TIMEOUT", "影盒浏览器加载 MissAV 超时，请检查桌面端网络或代理；后端代理可用并不代表浏览器也能访问")
        raise ResolveError("BROWSER_FETCH_FAILED", "影盒浏览器未能读取 MissAV 页面，请完全重启应用后重试")
    except ResolveError:
        raise
    except (socket.timeout, TimeoutError):
        raise ResolveError("BROWSER_SERVICE_TIMEOUT", "桌面浏览器服务等待超时，可能正被其他站点请求占用；请停止其他搜索或加载，稍后再试")
    except HTTPError:
        raise ResolveError("BROWSER_SERVICE_UNAVAILABLE", "桌面浏览器服务连接失效，请完全退出并重新启动影盒")
    except URLError as error:
        if isinstance(error.reason, (socket.timeout, TimeoutError)):
            raise ResolveError("BROWSER_SERVICE_TIMEOUT", "桌面浏览器服务等待超时，请停止其他搜索或加载后重试")
        raise ResolveError("BROWSER_SERVICE_UNAVAILABLE", "桌面浏览器服务无法连接，请完全退出并重新启动影盒")
    except (KeyError, ValueError, TypeError):
        raise ResolveError("BROWSER_RESPONSE_INVALID", "桌面浏览器服务返回异常，请完全重启影盒")


def resolve(value):
    from curl_cffi import requests
    initial = page_url(value)
    candidates = [initial]
    if "://" not in value:
        candidates += [initial + "-chinese-subtitle", initial + "-uncensored-leak"]
    proxy = configured_proxy()
    with requests.Session(impersonate="chrome", proxy=proxy) as session:
        for candidate in candidates:
            current = candidate
            for _ in range(5):
                # Never follow a page redirect to an arbitrary host.
                page_url(current)
                response = session.get(current, timeout=12, allow_redirects=False)
                if response.status_code in (301, 302, 303, 307, 308):
                    current = page_url(urljoin(current, response.headers.get("Location", "")))
                    continue
                break
            else:
                raise ResolveError("UPSTREAM_ERROR", "MissAV 页面重定向次数过多")
            text = response.text
            if response.status_code in (403, 429) or "Just a moment" in text or "cf-chl-" in text:
                rendered = browser_page(current)
                if not rendered:
                    raise ResolveError("SITE_VERIFICATION_REQUIRED", "MissAV 返回站点验证页，浏览器解析未成功；请确认已启动最新版桌面应用，检查网络或稍后重试")
                text = rendered
                status = 200
            else:
                status = response.status_code
            if status == 404:
                continue
            if status != 200:
                raise ResolveError("UPSTREAM_ERROR", f"MissAV 页面请求失败（HTTP {status}）")
            stream = extract_stream(text)
            if not media_url(stream):
                raise ResolveError("STREAM_NOT_FOUND", "视频流地址不受支持")
            # Keep the master playlist: the player can adapt quality and seek by segments.
            return {"success": True, "url": stream, "title": "MissAV · " + urlsplit(current).path.rstrip("/").split("/")[-1]}
    raise ResolveError("NOT_FOUND", "没有找到对应的 MissAV 视频，请尝试粘贴完整视频链接")


def main():
    try:
        result = resolve(sys.argv[1] if len(sys.argv) > 1 else "")
    except ResolveError as error:
        result = {"success": False, "code": error.code, "error": str(error)}
    except ImportError:
        result = {"success": False, "code": "PYTHON_DEPENDENCY_MISSING", "error": "解析环境缺少 curl_cffi，请安装后端 requirements.txt 中的依赖"}
    except Exception:
        result = {"success": False, "code": "NETWORK_ERROR", "error": "MissAV 请求失败，请检查后端代理和网络连接"}
    print(json.dumps(result, ensure_ascii=False))


def stream_media():
    """Header JSON followed by binary chunks, consumed as a pipe by Go."""
    from curl_cffi import requests
    current = sys.argv[2]
    method = sys.argv[3]
    headers = {"Referer": "https://missav.ai/", "Accept-Encoding": "identity"}
    if len(sys.argv) > 4 and sys.argv[4]:
        headers["Range"] = sys.argv[4]
    with requests.Session(impersonate="chrome", proxy=configured_proxy()) as session:
        for _ in range(5):
            if not media_url(current):
                raise ValueError("Unsupported media host")
            response = session.request(method, current, headers=headers, timeout=25, allow_redirects=False, stream=True)
            if response.status_code in (301, 302, 303, 307, 308):
                current = urljoin(current, response.headers.get("Location", ""))
                response.close()
                continue
            break
        else:
            raise ValueError("Too many redirects")
        metadata = {"status": response.status_code, "url": current, "headers": {
            key: response.headers[key] for key in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges") if key in response.headers
        }}
        sys.stdout.buffer.write(json.dumps(metadata).encode() + b"\n")
        sys.stdout.buffer.flush()
        if method != "HEAD":
            for chunk in response.iter_content(chunk_size=64 * 1024):
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
        response.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--stream":
        stream_media()
    else:
        main()
