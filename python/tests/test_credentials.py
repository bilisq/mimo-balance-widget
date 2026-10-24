"""Cookie：规范化、校验、脱敏、存取与旧配置迁移。"""

from __future__ import annotations

import json
import os
import unittest
from unittest import mock

from whale import config as config_mod, credentials, crypto
from whale.errors import WhaleError

from . import support

VALID = "api-platform_serviceToken=abc123; userId=2272017759"


class NormalizeTest(unittest.TestCase):
    def test_strips_cookie_prefix_and_whitespace(self):
        raw = "Cookie:  api-platform_serviceToken=a;\n  userId=1  "
        self.assertEqual(credentials.normalize(raw), "api-platform_serviceToken=a; userId=1")

    def test_validate(self):
        self.assertTrue(credentials.is_valid(VALID))
        self.assertFalse(credentials.is_valid("userId=1"))
        self.assertFalse(credentials.is_valid(""))

    def test_mask_never_leaks_token(self):
        masked = credentials.mask(VALID)
        self.assertNotIn("abc123", masked)
        self.assertIn("2272017759", masked)

    def test_mask_does_not_leak_tail_fragment(self):
        # 末尾几个字符也是凭证的一部分，粘到 issue 里就是泄露面
        masked = credentials.mask(VALID)
        self.assertNotIn("…", masked)
        self.assertIn("共", masked)
        tail = VALID.split("userId=")[0].rstrip("; ")[-6:]
        self.assertNotIn(tail, masked)

    def test_mask_when_empty(self):
        self.assertIn("未配置", credentials.mask(""))


class SaveTest(unittest.TestCase):
    def setUp(self):
        self.home = support.temp_dir()

    def test_rejects_incomplete_cookie(self):
        with self.assertRaises(WhaleError) as ctx:
            credentials.save(self.home, "userId=1")
        self.assertEqual(ctx.exception.code, "COOKIE_INVALID")

    def test_saves_and_resolves(self):
        result = credentials.save(self.home, VALID)
        expected = "dpapi" if crypto.available() else "plain"
        self.assertEqual(result["store"], expected)
        with mock.patch.dict(os.environ, {"MIMO_COOKIE": ""}, clear=False):
            self.assertEqual(credentials.resolve(config_mod.load(self.home)), VALID)

    def test_ciphertext_does_not_contain_token(self):
        credentials.save(self.home, VALID)
        raw = (self.home / "config.json").read_text(encoding="utf-8")
        self.assertNotIn("abc123", raw, "config.json 里不应出现明文 token")
        if crypto.available():
            cfg = json.loads(raw)
            self.assertEqual(cfg["cookie"], "", "加密后明文字段必须清空")
            self.assertTrue(cfg["cookieDpapi"])
            self.assertEqual(cfg["cookieStore"], "dpapi")

    def test_refuses_silent_plaintext_when_encryption_fails(self):
        # Windows 上 DPAPI 失败：宁可不存，也不能悄悄写明文
        with mock.patch("whale.credentials.crypto.protect", return_value=None), \
             mock.patch("whale.credentials.crypto.available", return_value=True), \
             mock.patch.dict(os.environ, {"MIMO_WHALE_ALLOW_PLAINTEXT": ""}, clear=False):
            with self.assertRaises(WhaleError) as ctx:
                credentials.save(self.home, VALID)
        self.assertEqual(ctx.exception.code, "ENCRYPT_FAILED")
        self.assertFalse((self.home / "config.json").exists())

    def test_plaintext_only_when_explicitly_allowed(self):
        with mock.patch("whale.credentials.crypto.protect", return_value=None), \
             mock.patch("whale.credentials.crypto.available", return_value=True), \
             mock.patch.dict(os.environ, {"MIMO_WHALE_ALLOW_PLAINTEXT": "1"}, clear=False):
            result = credentials.save(self.home, VALID)
        self.assertEqual(result["store"], "plain")
        self.assertEqual(result["warning"], "forced-plaintext")

    def test_env_wins(self):
        credentials.save(self.home, VALID)
        other = "api-platform_serviceToken=zzz; userId=999"
        with mock.patch.dict(os.environ, {"MIMO_COOKIE": other}, clear=False):
            self.assertEqual(credentials.resolve(config_mod.load(self.home)), other)

    def test_clear(self):
        credentials.save(self.home, VALID)
        credentials.clear(self.home)
        cfg = config_mod.load(self.home)
        self.assertEqual(cfg["cookieStore"], "none")
        with mock.patch.dict(os.environ, {"MIMO_COOKIE": ""}, clear=False):
            self.assertEqual(credentials.resolve(cfg), "")

    def test_legacy_migration(self):
        legacy = self.home / "whale.config.json"
        legacy.write_text('{"mimoCookie": "%s"}' % VALID, encoding="utf-8")
        with mock.patch.dict(os.environ, {"MIMO_COOKIE": ""}, clear=False):
            result = credentials.migrate_legacy(self.home, [legacy])
            self.assertIsNotNone(result)
            self.assertEqual(credentials.resolve(config_mod.load(self.home)), VALID)
        self.assertFalse(legacy.exists())
        backup = self.home / "whale.config.json.bak"
        self.assertTrue(backup.exists())
        # 备份里不能再有明文凭证
        self.assertNotIn("abc123", backup.read_text(encoding="utf-8"))

    def test_migration_skipped_when_already_configured(self):
        credentials.save(self.home, VALID)
        legacy = self.home / "whale.config.json"
        legacy.write_text('{"mimoCookie": "api-platform_serviceToken=x; userId=2"}', encoding="utf-8")
        with mock.patch.dict(os.environ, {"MIMO_COOKIE": ""}, clear=False):
            result = credentials.migrate_legacy(self.home, [legacy])
        self.assertEqual(result.get("skipped"), "already-configured")
        # 旧文件被搬走且抹掉了明文
        self.assertFalse(legacy.exists())
        self.assertNotIn("api-platform_serviceToken=x", (self.home / "whale.config.json.bak").read_text(encoding="utf-8"))


class ConfigTest(unittest.TestCase):
    def test_refresh_seconds_is_clamped(self):
        self.assertEqual(config_mod.refresh_seconds({"refreshSeconds": 1}), config_mod.MIN_REFRESH)
        self.assertEqual(config_mod.refresh_seconds({"refreshSeconds": 999999}), config_mod.MAX_REFRESH)
        self.assertEqual(config_mod.refresh_seconds({}), 60)
        self.assertEqual(config_mod.refresh_seconds({"refreshSeconds": "abc"}), 60)

    def test_unknown_keys_are_dropped(self):
        cfg = config_mod.normalize({"refreshSeconds": 30, "hack": 1})
        self.assertNotIn("hack", cfg)

    def test_ensure_creates_file(self):
        home = support.temp_dir()
        config_mod.ensure(home)
        self.assertTrue((home / "config.json").exists())


if __name__ == "__main__":
    unittest.main()
