"""
문서 로더 모듈 (하이브리드 파서)
Test 16에서 확정된 LlamaParse(메인) + Marker(표 특화 서브) 하이브리드 아키텍처를 적용합니다.

파서 전략 (Test 16 최종 확정):
  - LlamaParse (Primary): 종합 77.3%, 구조화 레이아웃 보존 최상, ±1 페이지 버퍼 시 +5.8%p 상승
  - Marker (Specialized): 표(Table) 영역 66.7%로 LlamaParse(58.3%) 압도, 로컬 GPU 운영 가능
"""
import logging
import os
import hashlib
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import List, Optional

from dotenv import load_dotenv
from langchain_core.documents import Document

logger = logging.getLogger(__name__)

load_dotenv()


class DocumentLoader:
    """LlamaParse + Marker 하이브리드 PDF 문서 로더"""

    def __init__(self, document_dir: str = "data/documents", use_marker: bool = False, cache_dir: str = None):
        self.document_dir = document_dir
        self.use_marker = use_marker
        self.cache_dir = cache_dir or "data/parsed_cache"
        os.makedirs(self.cache_dir, exist_ok=True)

        # ── LlamaParse (High-Quality Cloud) ──
        self.llama_parser = None
        api_key = os.getenv("LLAMA_CLOUD_API_KEY")
        if api_key:
            from llama_parse import LlamaParse
            self.llama_parser = LlamaParse(
                result_type="markdown",
                language="ko",
                num_workers=4,
                parsing_instruction="""
이 문서는 기술 매뉴얼 및 법적 규정 문서를 포함하고 있습니다. 
문서 내의 모든 표(Table) 데이터는 반드시 마크다운 표(Markdown Table) 형식으로 정밀하게 추출하세요. 
표의 헤더(Header) 구조를 유지하고, 셀 내에 데이터가 누락되지 않도록 텍스트 추출 품질을 극대화하세요.
레이아웃 보존을 위해 문단의 전후 맥락을 유지하여 파싱하세요.
"""
            )
            logger.info("LlamaParse (Cloud) 활성화 완료")
        else:
            logger.warning("LLAMA_CLOUD_API_KEY 없음 — Fast Local 모드로 자동 전환")

        # ── Marker (Specialized Table Sub) ──
        self.marker_converter = None
        if use_marker:
            try:
                from marker.converters.pdf import PdfConverter
                from marker.models import create_model_dict
                logger.info("Marker 모델 로딩 중 (GPU)...")
                self.marker_converter = PdfConverter(artifact_dict=create_model_dict())
                logger.info("Marker 초기화 완료")
            except Exception as e:
                logger.warning(f"Marker 사용 불가: {e}")
                self.use_marker = False

    # ─────────────────────────────────────────────
    # 개별 파서 메서드
    # ─────────────────────────────────────────────
    def _parse_with_llamaparse(self, file_path: str) -> List[Document]:
        """LlamaParse로 PDF 파싱 (3회 재시도 및 실패 시 None 반환)"""
        import time
        max_retries = 3
        for attempt in range(max_retries):
            try:
                llama_docs = self.llama_parser.load_data(file_path)
                lc_docs = []
                for i, ldoc in enumerate(llama_docs):
                    lc_docs.append(Document(
                        page_content=ldoc.text,
                        metadata={
                            "source_file": os.path.basename(file_path),
                            "page_no": i + 1,
                            "parse_method": "llamaparse",
                        },
                    ))
                return lc_docs
            except Exception as e:
                logger.warning(f"LlamaParse 시도 {attempt+1}/{max_retries} 실패: {e}")
                if attempt < max_retries - 1:
                    time.sleep(2) # 짧은 대기 후 재시도
        return None  # 최종 실패 시 None 반환

    def _parse_with_marker(self, file_path: str) -> List[Document]:
        """Marker로 PDF 파싱 (Local GPU VLM) — 표 특화"""
        if self.marker_converter is None:
            return []

        rendered = self.marker_converter(file_path)
        markdown_text = rendered.markdown

        # Marker는 전체를 하나의 마크다운으로 반환하므로 페이지 구분자("---")로 분리
        pages = markdown_text.split("\n---\n") if "\n---\n" in markdown_text else [markdown_text]
        lc_docs = []
        for i, page_text in enumerate(pages):
            if page_text.strip():
                lc_docs.append(Document(
                    page_content=page_text.strip(),
                    metadata={
                        "source_file": os.path.basename(file_path),
                        "page_no": i + 1,
                        "parse_method": "marker",
                    },
                ))
        return lc_docs

    def _get_cache_path(self, file_path: str, suffix: str = "llamaparse") -> str:
        """캐시 파일 경로 반환 (파일명 길이 제한 해결을 위해 해시 사용)"""
        fname = os.path.basename(file_path)
        # 파일명이 너무 길면 OS 에러가 발생하므로, 해시값을 섞어서 짧게 만듦
        name_hash = hashlib.md5(fname.encode()).hexdigest()[:10]
        truncated_name = fname[:50].replace(" ", "_") # 앞 50자만 사용
        return os.path.join(self.cache_dir, f"{truncated_name}_{name_hash}.{suffix}.md")

    def _load_with_pymupdf(self, file_path: str, fname: str) -> List[Document]:
        """PyMuPDF 로컬 파서 — source_file/page_no 메타데이터를 보강해 반환.

        PyMuPDFLoader 기본 메타에는 source_file 키가 없어(그대신 source/file_path/page),
        출처 배지 조립부(generator)가 문서를 스킵 → 출처가 표시되지 않는 문제가 있었다.
        LlamaParse가 없거나 실패해 이 폴백을 타는 경우에도 출처가 정상 표기되도록 보강한다.
        """
        from langchain_community.document_loaders import PyMuPDFLoader
        docs = PyMuPDFLoader(file_path).load()
        for i, d in enumerate(docs):
            d.metadata["source_file"] = fname
            _pg = d.metadata.get("page")
            d.metadata["page_no"] = (_pg + 1) if isinstance(_pg, int) else (i + 1)
        return docs

    def load_pdf(self, file_path: str) -> List[Document]:
        """하이브리드 파싱 로직 (캐시 우선 + 재시도 + 폴백)"""
        fname = os.path.basename(file_path)
        llama_cache = self._get_cache_path(file_path, "llamaparse")
        content_parts = []
        
        # 1. 로컬 캐시 확인 및 메타데이터 복원
        if os.path.exists(llama_cache):
            import json
            try:
                with open(llama_cache, "r", encoding="utf-8") as f:
                    cache_data = json.load(f)
                    docs = []
                    for item in cache_data:
                        meta = item["metadata"] if isinstance(item.get("metadata"), dict) else {}
                        # JSON 메타에 source_file이 없을 때만 PDF 파일명으로 채움 (커스텀 source_file 보존)
                        if "source_file" not in meta:
                            meta = {**meta, "source_file": fname}
                        docs.append(Document(page_content=item["text"], metadata=meta))
                    return docs
            except json.JSONDecodeError:
                # [버그 픽스] 과거 버전에서 순수 마크다운 텍스트로 저장했던 캐시 파일 호환성 유지
                with open(llama_cache, "r", encoding="utf-8") as f:
                    text = f.read()
                    return [Document(page_content=text, metadata={"source_file": fname, "parse_method": "llamaparse_legacy"})]
        
        # 2. LlamaParse (Cloud VLM) 시도
        elif self.llama_parser:
            logger.info(f"[LlamaParse] Cloud 파싱 중: {fname}")
            llama_docs = self._parse_with_llamaparse(file_path)
            
            if llama_docs:
                # 텍스트와 메타데이터를 함께 저장 (JSON 형태 혹은 특수 구분자 활용)
                # 우선은 원본 리스트를 반환하여 메타데이터 유실을 막습니다.
                import json
                cache_data = [{"text": d.page_content, "metadata": d.metadata} for d in llama_docs]
                with open(llama_cache, "w", encoding="utf-8") as f:
                    json.dump(cache_data, f, ensure_ascii=False, indent=2)
                return llama_docs
            else:
                # LlamaParse 최종 실패 시 로컬 고속 파서로 긴급 우회
                logger.warning(f"[Fallback] LlamaParse 최종 실패 → 로컬 파서 전환: {fname}")
                return self._load_with_pymupdf(file_path, fname)
        else:
            # 설정상 LlamaParse가 아예 없으면 로컬 사용
            return self._load_with_pymupdf(file_path, fname)

        # 3. Marker (표 서브 파서 - 필요 시 활성화)
        if self.use_marker and self.marker_converter:
            marker_cache = self._get_cache_path(file_path, "marker")
            if os.path.exists(marker_cache):
                with open(marker_cache, "r", encoding="utf-8") as f:
                    content_parts.append(f.read())
            else:
                try:
                    marker_docs = self._parse_with_marker(file_path)
                    text = "\n\n".join([d.page_content for d in marker_docs])
                    with open(marker_cache, "w", encoding="utf-8") as f:
                        f.write(text)
                    content_parts.append(text)
                except:
                    pass

        full_text = "\n\n".join(content_parts)
        return [Document(
            page_content=full_text,
            metadata={"source_file": fname, "parse_method": "hybrid_cache"}
        )]

    # ─────────────────────────────────────────────
    # 전체 문서 로드 (안정적인 멀티프로세싱 병렬 버전)
    # ─────────────────────────────────────────────
    def _worker_load_pdf(self, fpath: str) -> List[Document]:
        """독립된 프로세스에서 개별 파일 파싱 (API 키 등 환경 유지 필요)"""
        # 자식 프로세스에서 필요한 초기화를 수행하거나 기존 인스턴스 사용
        return self.load_pdf(fpath)

    def load_all(self, max_workers: int = 8) -> List[Document]:
        """ProcessPoolExecutor를 사용하여 문서 병렬 로드 (이벤트 루프 충돌 방지)"""
        all_docs: List[Document] = []

        if not os.path.isdir(self.document_dir):
            raise FileNotFoundError(f"문서 디렉토리가 존재하지 않습니다: {self.document_dir}")

        pdf_files = []
        for root, _, files in os.walk(self.document_dir):
            for fname in sorted(files):
                if fname.lower().endswith(".pdf"):
                    pdf_files.append(os.path.join(root, fname))

        if not pdf_files:
            logger.warning(f"분석할 PDF 파일이 없습니다: {self.document_dir}")
            return []

        logger.info(f"총 {len(pdf_files)}개 PDF 발견 (병렬 처리: {max_workers}코어)")

        # 멀티프로세싱 실행
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            future_to_file = {executor.submit(self.load_pdf, fpath): fpath for fpath in pdf_files}
            
            for future in as_completed(future_to_file):
                fpath = future_to_file[future]
                try:
                    docs = future.result()
                    all_docs.extend(docs)
                except Exception as e:
                    logger.error(f"문서 처리 실패: {os.path.basename(fpath)} — {e}")

        logger.info(f"전체 문서 로드 완료: {len(all_docs)}개 (PDF {len(pdf_files)}개 처리)")
        return all_docs
