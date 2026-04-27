#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VOD Parser
解析 TVBox VOD 源获取播放地址
"""

import sys
import json
import subprocess
import os
import requests
import re
from urllib.parse import urljoin


def _find_vod_config():
    """读取 vod.json 配置"""
    vod_config_paths = [
        "vod.json",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "vod.json"),
    ]
    for p in vod_config_paths:
        try:
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            continue
    return None


def _run_node_runner(js_url, action, ext=None):
    """调用 Node.js CatSpider runner"""
    runner_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "catspider_runner.js"
    )
    if not os.path.exists(runner_path):
        return {"success": False, "error": f"catspider_runner.js not found at {runner_path}"}

    ext_json = json.dumps(ext, ensure_ascii=False) if ext else "{}"
    try:
        # Find node_modules - use PROJECT_ROOT from Go backend, or compute from file path
        project_root = os.environ.get('PROJECT_ROOT', '')
        if not project_root:
            project_root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
        node_modules = os.path.join(project_root, 'node_modules')
        env = os.environ.copy()
        if os.path.isdir(node_modules):
            env['NODE_PATH'] = node_modules

        result = subprocess.run(
            ["node", runner_path, js_url, action, ext_json],
            capture_output=True, timeout=60,
            encoding='utf-8', errors='replace',
            env=env
        )
        if result.returncode != 0:
            return {"success": False, "error": f"Node runner failed: {result.stderr[:500]}"}
        output = result.stdout.strip()
        if not output:
            return {"success": False, "error": "Node runner returned empty output"}
        return json.loads(output)
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Node runner timed out"}
    except json.JSONDecodeError as e:
        return {"success": False, "error": f"Invalid JSON from node runner: {str(e)}"}
    except FileNotFoundError:
        return {"success": False, "error": "Node.js not found - please install Node.js"}
    except Exception as e:
        return {"success": False, "error": f"Node runner error: {str(e)}"}


def get_config(site_name):
    """获取站点配置"""
    vod_config = _find_vod_config()
    if not vod_config:
        return {"success": False, "error": "vod.json not found"}

    site_config = None
    for site in vod_config.get('sites', []):
        if site.get('name') == site_name:
            site_config = site
            break

    if not site_config:
        return {"success": False, "error": f"Site not found: {site_name}"}

    site_type = site_config.get('type')
    ext_url = site_config.get('ext')

    if site_type == 3:
        return _run_node_runner(ext_url, "getConfig")

    return {"success": False, "error": f"Unsupported site type: {site_type}"}


def search_vod(site_name, keyword, page=1):
    """搜索 VOD 资源"""
    vod_config = _find_vod_config()
    if not vod_config:
        return {"success": False, "error": "vod.json not found"}

    site_config = None
    for site in vod_config.get('sites', []):
        if site.get('name') == site_name:
            site_config = site
            break

    if not site_config:
        return {"success": False, "error": f"Site not found: {site_name}"}

    site_type = site_config.get('type')
    ext_url = site_config.get('ext')

    if site_type == 3:
        return _run_node_runner(ext_url, "search", {"text": keyword, "page": page})
    elif site_type == 1:
        api_url = site_config.get('api')
        try:
            url = f"{api_url}?ac=videolist&wd={keyword}&pg={page}"
            resp = requests.get(url, timeout=10)
            data = resp.json()
            return {"success": True, "data": data}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return {"success": False, "error": f"Unsupported site type: {site_type}"}


def get_cards(site_name, ext):
    """获取分类列表"""
    vod_config = _find_vod_config()
    if not vod_config:
        return {"success": False, "error": "vod.json not found"}

    site_config = None
    for site in vod_config.get('sites', []):
        if site.get('name') == site_name:
            site_config = site
            break

    if not site_config:
        return {"success": False, "error": f"Site not found: {site_name}"}

    site_type = site_config.get('type')
    ext_url = site_config.get('ext')

    if site_type == 3:
        return _run_node_runner(ext_url, "getCards", ext)

    return {"success": False, "error": f"Unsupported site type: {site_type}"}


def get_tracks(site_name, url):
    """获取剧集列表"""
    vod_config = _find_vod_config()
    if not vod_config:
        return {"success": False, "error": "vod.json not found"}

    site_config = None
    for site in vod_config.get('sites', []):
        if site.get('name') == site_name:
            site_config = site
            break

    if not site_config:
        return {"success": False, "error": f"Site not found: {site_name}"}

    site_type = site_config.get('type')
    ext_url = site_config.get('ext')

    if site_type == 3:
        return _run_node_runner(ext_url, "getTracks", {"url": url})

    return {"success": False, "error": f"Unsupported site type: {site_type}"}


def get_playinfo(site_name, args):
    """获取播放地址 - args 可以包含 url, vid, pkey, ref 等"""
    vod_config = _find_vod_config()
    if not vod_config:
        return {"success": False, "error": "vod.json not found"}

    site_config = None
    for site in vod_config.get('sites', []):
        if site.get('name') == site_name:
            site_config = site
            break

    if not site_config:
        return {"success": False, "error": f"Site not found: {site_name}"}

    site_type = site_config.get('type')
    ext_url = site_config.get('ext')

    if site_type == 3:
        return _run_node_runner(ext_url, "getPlayinfo", args)
    elif site_type == 1:
        url = args.get('url', '') if isinstance(args, dict) else str(args)
        try:
            resp = requests.get(url, timeout=10)
            content = resp.text
            m3u8_match = re.search(r'(https?://[^\s"\'<>]+\.m3u8[^\s"\'<>]*)', content)
            mp4_match = re.search(r'(https?://[^\s"\'<>]+\.mp4[^\s"\'<>]*)', content)
            play_url = m3u8_match.group(1) if m3u8_match else (mp4_match.group(1) if mp4_match else None)
            if play_url:
                return {"success": True, "url": play_url, "site": site_name}
            return {"success": False, "error": "No playable URL found"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return {"success": False, "error": f"Unsupported site type: {site_type}"}


def parse_vod(site_name, video_id, episode=None):
    """
    解析 VOD 播放地址 (兼容旧接口)
    对于 CatSpider 站点，video_id 作为搜索关键词
    """
    return search_vod(site_name, video_id)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: vod_parser.py <action> <site_name> [args_json]"}))
        sys.exit(1)

    action = sys.argv[1]
    site_name = sys.argv[2]
    args_json = sys.argv[3] if len(sys.argv) > 3 else "{}"

    try:
        args = json.loads(args_json)
    except json.JSONDecodeError:
        args = {}

    if action == "getConfig":
        result = get_config(site_name)
    elif action == "search":
        result = search_vod(site_name, args.get("text", ""), args.get("page", 1))
    elif action == "getCards":
        result = get_cards(site_name, args)
    elif action == "getTracks":
        result = get_tracks(site_name, args.get("url", ""))
    elif action == "getPlayinfo":
        result = get_playinfo(site_name, args)
    elif action == "parse":
        result = parse_vod(site_name, args.get("videoID", ""), args.get("episode"))
    else:
        result = {"success": False, "error": f"Unknown action: {action}"}

    print(json.dumps(result, ensure_ascii=False))
