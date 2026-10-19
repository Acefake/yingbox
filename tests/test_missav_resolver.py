import importlib.util
from pathlib import Path
import unittest
import json
import socket
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("missav_resolver", Path(__file__).resolve().parents[1] / "packages/services/backend/py/missav_resolver.py")
resolver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver)


class MissavResolverTests(unittest.TestCase):
    def test_browser_failure_diagnostics(self):
        with patch.object(resolver.Path, "read_text", side_effect=FileNotFoundError()):
            with self.assertRaises(resolver.ResolveError) as error:
                resolver.browser_page("https://missav.ai/cn/test")
        self.assertEqual(error.exception.code, "BROWSER_SERVICE_UNAVAILABLE")
        discovery = json.dumps({"url": "http://127.0.0.1:12345", "token": "fixture"})
        for reason, code in (("challenge not passed", "SITE_VERIFICATION_REQUIRED"), ("browser load timeout", "BROWSER_LOAD_TIMEOUT")):
            opener = MagicMock()
            opener.open.return_value.__enter__.return_value.read.return_value = json.dumps({"ok": False, "error": reason}).encode()
            with patch.object(resolver.Path, "read_text", return_value=discovery), patch.object(resolver, "build_opener", return_value=opener):
                with self.assertRaises(resolver.ResolveError) as error:
                    resolver.browser_page("https://missav.ai/cn/test")
            self.assertEqual(error.exception.code, code)
            self.assertEqual(opener.open.call_args.kwargs["timeout"], 60)
        opener = MagicMock()
        opener.open.side_effect = socket.timeout()
        with patch.object(resolver.Path, "read_text", return_value=discovery), patch.object(resolver, "build_opener", return_value=opener):
            with self.assertRaises(resolver.ResolveError) as error:
                resolver.browser_page("https://missav.ai/cn/test")
        self.assertEqual(error.exception.code, "BROWSER_SERVICE_TIMEOUT")

    def test_browser_fallback_after_verification(self):
        session = MagicMock()
        session.__enter__.return_value = session
        session.get.return_value.status_code = 403
        session.get.return_value.text = "Just a moment"
        with patch("curl_cffi.requests.Session", return_value=session), patch.object(resolver, "browser_page", return_value='source="https://surrit.com/video/playlist.m3u8"') as browser:
            result = resolver.resolve("AKDL-331")
        self.assertTrue(result["success"])
        browser.assert_called_once_with("https://missav.ai/cn/akdl-331")
        with patch("curl_cffi.requests.Session", return_value=session), patch.object(resolver, "browser_page", return_value=None):
            with self.assertRaises(resolver.ResolveError) as error:
                resolver.resolve("AKDL-331")
        self.assertEqual(error.exception.code, "SITE_VERIFICATION_REQUIRED")

    def test_inputs(self):
        self.assertEqual(resolver.page_url("AKDL-331"), "https://missav.ai/cn/akdl-331")
        self.assertEqual(resolver.page_url("https://missav.ws/cn/test#player"), "https://missav.ws/cn/test")
        for value in ("https://127.0.0.1/a", "https://missav.ai.evil.test/a", "file:///a", "https://user:pass@missav.ai/a", "https://missav.ai:999/a", ""):
            with self.assertRaises((resolver.ResolveError, ValueError)):
                resolver.page_url(value)

    def test_catalog_listing(self):
        self.assertEqual(resolver.listing_url("new", 1, "latest"), "https://missav.ai/cn/new")
        self.assertEqual(resolver.listing_url("chinese-subtitle", 2, "hot"), "https://missav.ai/cn/chinese-subtitle?page=2&sort=monthly_views")
        for category, page, sort in (("genres", 1, "latest"), ("new", 0, "latest"), ("new", 1, "score")):
            with self.assertRaises(resolver.ResolveError):
                resolver.listing_url(category, page, sort)
        page = '''
            <div class="thumbnail group">
              <a href="https://missav.ai/cn/abp-001"><img data-src="https://fourhoi.com/abp-001/cover-t.jpg"></a>
              <span class="absolute">1:02:03</span>
              <a class="text-secondary group-hover:text-primary" href="https://missav.ai/cn/abp-001">ABP-001 Sample</a>
            </div>
            <a href="https://missav.ai/cn/new?page=2" rel="next">next</a>
        '''
        items, has_next = resolver.parse_catalog(page)
        self.assertTrue(has_next)
        self.assertEqual(items, [{"code": "abp-001", "title": "ABP-001 Sample", "poster": "https://fourhoi.com/abp-001/cover-t.jpg", "duration": "1:02:03"}])
        for code in ("new", "../a", ""):
            with self.assertRaises(resolver.ResolveError):
                resolver.fetch_cover(code)

    def test_stream_formats(self):
        uuid = "12345678-1234-abcd-5678-123456789abc"
        packed = "m3u8|" + "|".join(uuid.split("-")[::-1]) + "|com|surrit|https|video"
        self.assertEqual(resolver.extract_stream(packed), f"https://surrit.com/{uuid}/playlist.m3u8")
        self.assertEqual(resolver.extract_stream(r'source="https:\/\/surrit.com/id/playlist.m3u8?token=abc&amp;x=1"'), "https://surrit.com/id/playlist.m3u8?token=abc&x=1")
        with self.assertRaises(resolver.ResolveError):
            resolver.extract_stream("<html>No source</html>")


if __name__ == "__main__":
    unittest.main()
