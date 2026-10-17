"""Exercise scraper requests without importing comm (which writes files)."""
import ast
import json
import os
from pathlib import Path
import re
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urljoin, urlparse

from curl_cffi import requests

ROOT = Path(__file__).resolve().parents[1]


def load_scraper():
    source = ROOT / 'packages/services/backend/py/src/scraper.py'
    tree = ast.parse(source.read_text(encoding='utf-8'))
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Sracper')
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), cls], type_ignores=[])
    env = dict(requests=requests, json=json, os=os, re=re, urljoin=urljoin, urlparse=urlparse,
               headers={'User-Agent': 'test'}, scraperDomain='www.javbus.com',
               logger=SimpleNamespace(error=lambda *_: None))
    exec(compile(ast.fix_missing_locations(module), str(source), 'exec'), env)
    return env['Sracper']('/tmp')


def response(status=200, text='movie metadata', location=None):
    return SimpleNamespace(status_code=status, text=text, url='https://www.javbus.com/AKDL-331',
                           headers={'Location': location} if location else {}, raise_for_status=lambda: None)


@unittest.skipIf(not (ROOT / 'packages/services/backend/py/src/scraper.py').exists(),
                 'Legacy scraper removed; adult metadata is managed by Amane')
class JavBusFetchTests(unittest.TestCase):
    def setUp(self):
        self.scraper = load_scraper()
        self.url = 'https://www.javbus.com/AKDL-331'

    def test_verification_redirect_is_actionable(self):
        with patch.object(self.scraper.session, 'get', return_value=response(302, '', '/doc/driver-verify')) as get:
            self.assertIsNone(self.scraper._fetch_html(self.url))
            self.assertIn('YINGBOX_JAVBUS_COOKIES', self.scraper.last_fetch_error)
            self.assertEqual(get.call_count, 1)

    def test_verification_html_is_not_metadata(self):
        with patch.object(self.scraper.session, 'get', return_value=response(text='<title>Age Verification JavBus</title>')):
            self.assertIsNone(self.scraper._fetch_html(self.url))
            self.assertIn('YINGBOX_JAVBUS_COOKIES', self.scraper.last_fetch_error)

    def test_cookie_is_sent_only_to_exact_host(self):
        with patch.dict(os.environ, {'YINGBOX_JAVBUS_COOKIES': json.dumps({'www.javbus.com': 'session=secret'})}):
            with patch.object(self.scraper.session, 'get', return_value=response()) as get:
                self.assertEqual(self.scraper._fetch_html(self.url), 'movie metadata')
                self.assertEqual(get.call_args.kwargs['headers']['Cookie'], 'session=secret')
                self.scraper._fetch_html('https://www.busdmm.ink/AKDL-331')
                self.assertNotIn('Cookie', get.call_args.kwargs['headers'])

    def test_cross_host_redirect_does_not_receive_cookie(self):
        with patch.object(self.scraper.session, 'get', return_value=response(302, '', 'https://other.example/')) as get:
            self.assertIsNone(self.scraper._fetch_html(self.url))
            self.assertEqual(get.call_count, 1)

    def test_normal_redirect_is_followed(self):
        with patch.object(self.scraper.session, 'get', side_effect=[response(302, '', '/en/AKDL-331'), response()]) as get:
            self.assertEqual(self.scraper._fetch_html(self.url), 'movie metadata')
            self.assertEqual(get.call_count, 2)

    def test_network_failure_has_no_secret(self):
        with patch.object(self.scraper.session, 'get', side_effect=requests.exceptions.RequestException('session=secret')):
            self.assertIsNone(self.scraper._fetch_html(self.url))
            self.assertIn('www.javbus.com', self.scraper.last_fetch_error)
            self.assertNotIn('secret', self.scraper.last_fetch_error)

    def test_bad_cookie_config_is_rejected(self):
        with patch.dict(os.environ, {'YINGBOX_JAVBUS_COOKIES': '[]'}):
            with patch.object(self.scraper.session, 'get') as get:
                self.assertIsNone(self.scraper._fetch_html(self.url))
                get.assert_not_called()


if __name__ == '__main__':
    unittest.main()
