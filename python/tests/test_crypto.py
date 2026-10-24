"""DPAPI 加解密（仅 Windows 可测）：Windows 上跑真实往返，其它平台跳过。"""

from __future__ import annotations

import unittest

from whale import crypto


@unittest.skipUnless(crypto.available(), "DPAPI 只在 Windows 上可用")
class DpapiTest(unittest.TestCase):
    def test_roundtrip(self):
        secret = "api-platform_serviceToken=abc; userId=1"
        blob = crypto.protect(secret)
        self.assertIsNotNone(blob, "加密失败时不应返回 None（否则会静默落明文）")
        self.assertNotIn("abc", blob)
        self.assertEqual(crypto.unprotect(blob), secret)

    def test_ciphertext_differs_each_time(self):
        # DPAPI 带随机盐/IV，密文不应固定，否则能看出"两次存的同一个 Cookie"
        a = crypto.protect("same-value")
        b = crypto.protect("same-value")
        self.assertNotEqual(a, b)

    def test_tampered_ciphertext_returns_none(self):
        blob = crypto.protect("hello")
        broken = blob[:-8] + ("A" if not blob.endswith("A") else "B") * 8
        self.assertIsNone(crypto.unprotect(broken))

    def test_garbage_returns_none(self):
        self.assertIsNone(crypto.unprotect("not-base64-@@@"))
        self.assertIsNone(crypto.unprotect(""))


class AvailabilityTest(unittest.TestCase):
    def test_available_is_bool(self):
        self.assertIsInstance(crypto.available(), bool)


if __name__ == "__main__":
    unittest.main()
