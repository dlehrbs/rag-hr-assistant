"""
Parent-Child 문서 분할 모듈
Test 07에서 확정된 Parent-Child 구조를 적용합니다.
- Parent (1500자): LLM에게 제공되는 풍부한 컨텍스트 (조항 단위 유지)
- Child (400자): 정밀 검색을 위한 잘게 쪼갠 청크
"""
import logging
import uuid
from collections import defaultdict
from typing import Dict, List, Tuple

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)


class ParentChildSplitter:
    """Parent-Child 구조 문서 분할기"""

    # 이보다 짧은 청크는 문서 헤더([문서: X] 등)만 있는 노이즈 청크로 간주하여 제외
    MIN_PARENT_CHARS: int = 50
    MIN_CHILD_CHARS:  int = 30

    def __init__(
        self,
        parent_chunk_size: int = 1500,
        child_chunk_size: int = 400,
        child_chunk_overlap: int = 50,
        parent_chunk_overlap: int = 200,
    ):
        self.parent_chunk_size = parent_chunk_size
        self.child_chunk_size = child_chunk_size

        # 조항(제X조) 경계를 최우선 분리 기준으로 사용 — 조항 중간 잘림 방지
        self._parent_splitter = RecursiveCharacterTextSplitter(
            chunk_size=parent_chunk_size,
            chunk_overlap=parent_chunk_overlap,
            separators=[r"\n제 \d+ 조", "\n\n", "\n", ". ", " ", ""],
            is_separator_regex=True,
            keep_separator=True,
        )
        self._child_splitter = RecursiveCharacterTextSplitter(
            chunk_size=child_chunk_size,
            chunk_overlap=child_chunk_overlap,
            separators=["\n\n", "\n", ". ", " ", ""],
        )

    def split(self, documents: List[Document]) -> Tuple[Dict[str, Document], List[Document]]:
        """
        문서를 Parent → Child 계층으로 분할합니다.

        Returns:
            parent_map: {doc_id: parent_document}
            child_docs: parent_id 메타데이터가 포함된 자식 청크 리스트
        """
        # source_file 단위로 병합 — PDF 페이지 경계로 나뉜 청크들을 이어붙여 조항 단위 분리 가능하게 함
        file_groups: Dict[str, List[Document]] = defaultdict(list)
        for doc in documents:
            key = doc.metadata.get("source_file", "unknown")
            file_groups[key].append(doc)

        merged_docs = []
        # 역추적용: source_file → [(page_no, 원본 텍스트 앞부분)] 매핑 보존
        page_index: Dict[str, List[tuple]] = {}
        for source_file, docs in file_groups.items():
            meta = {k: v for k, v in docs[0].metadata.items() if k != "page_no"}
            merged_docs.append(Document(
                page_content="\n\n".join(d.page_content for d in docs),
                metadata=meta,
            ))
            page_index[source_file] = [
                (d.metadata.get("page_no"), d.page_content)
                for d in docs if d.metadata.get("page_no")
            ]
        logger.info(f"source_file 병합: {len(documents)}개 청크 → {len(merged_docs)}개 문서")

        parent_chunks = self._parent_splitter.split_documents(merged_docs)

        parent_map: Dict[str, Document] = {}
        child_docs: List[Document] = []
        skipped_parents = 0
        skipped_children = 0

        for parent in parent_chunks:
            if len(parent.page_content.strip()) < self.MIN_PARENT_CHARS:
                skipped_parents += 1
                continue

            # parent 청크 시작 텍스트가 어느 원본 페이지에 포함되는지 역추적
            src = parent.metadata.get("source_file", "")
            if src in page_index:
                chunk_head = parent.page_content.strip()[:60]
                for page_no, orig_text in page_index[src]:
                    if chunk_head in orig_text:
                        parent.metadata["page_no"] = page_no
                        break

            doc_id = str(uuid.uuid4())
            parent.metadata["doc_id"] = doc_id
            parent_map[doc_id] = parent

            children = self._child_splitter.split_documents([parent])
            for child in children:
                if len(child.page_content.strip()) < self.MIN_CHILD_CHARS:
                    skipped_children += 1
                    continue
                child.metadata["parent_id"] = doc_id
                child_docs.append(child)

        if skipped_parents or skipped_children:
            logger.info(f"노이즈 청크 제거: parent {skipped_parents}개, child {skipped_children}개 건너뜀 (길이 미달)")
        logger.info(f"분할 완료: Parent {len(parent_map)}개 → Child {len(child_docs)}개")
        return parent_map, child_docs
