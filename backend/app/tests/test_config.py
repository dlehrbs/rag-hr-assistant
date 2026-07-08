"""[tests/test_config] 브랜딩·문서명 추출 등 순수 설정 로직 단위테스트.
무거운 의존성(torch/langchain) 없이 CI에서 GPU 없이 실행 가능."""
import os
import sys
import unittest

# backend/app 을 import 경로에 추가 (tests/ 의 부모)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import config  # noqa: E402


class TestDocName(unittest.TestCase):
    """extract_doc_name: 접두어 규칙이 없을 때는 확장자만 제거."""

    def test_strips_extension(self):
        self.assertEqual(config.extract_doc_name("Leave Policy.pdf"), "Leave Policy")

    def test_markdown(self):
        self.assertEqual(config.extract_doc_name("handbook.md"), "handbook")

    def test_dotted_name_kept(self):
        self.assertEqual(config.extract_doc_name("v1.2.final.pdf"), "v1.2.final")

    def test_no_extension(self):
        self.assertEqual(config.extract_doc_name("README"), "README")


class TestBranding(unittest.TestCase):
    """COMPANY_NAME / APP_NAME 은 문자열 상수로 항상 존재해야 한다(프롬프트 주입용)."""

    def test_company_name_is_str(self):
        self.assertIsInstance(config.COMPANY_NAME, str)
        self.assertTrue(config.COMPANY_NAME)

    def test_app_name_is_str(self):
        self.assertIsInstance(config.APP_NAME, str)
        self.assertTrue(config.APP_NAME)


if __name__ == "__main__":
    unittest.main()
