"""
用法: python tools/fetch_meta.py <车牌号>
输出: JSON到stdout
"""
import sys
import json
import os
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.comm import myproxy, configs
from src.scraper import Sracper, AVMetadata
from dataclasses import asdict

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing avid"}))
        sys.exit(1)

    avid = sys.argv[1].upper()
    scraper_domains = configs.get('ScraperDomain', [])

    scraper = Sracper(path="/tmp", proxy=myproxy)
    metadata = None
    for domain in scraper_domains:
        scraper.domain = domain
        url = f"https://{domain}/{avid}"
        html = scraper._fetch_html(url)
        if not html:
            continue
        metadata = scraper._extract(html)
        if metadata:
            break

    if not metadata:
        print(json.dumps({"error": "fetch html failed"}))
        sys.exit(1)

    gid_uc_pairs = getattr(metadata, '_gid_uc_pairs', [])
    if gid_uc_pairs:
        metadata.magnets = scraper._fetch_magnets(metadata.avid, gid_uc_pairs)

    result = {
        "avid": metadata.avid,
        "title": metadata.title,
        "cover": metadata.cover,
        "release_date": metadata.release_date,
        "duration": metadata.duration,
        "description": metadata.description,
        "keywords": list(metadata.keywords) if metadata.keywords else [],
        "actress": metadata.actress,
        "fanarts": list(metadata.fanarts) if metadata.fanarts else [],
        "magnets": list(metadata.magnets) if metadata.magnets else [],
    }
    print(json.dumps(result, ensure_ascii=False))
