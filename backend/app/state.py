"""[state] 앱 런타임 가변 전역 상태(참조공유). 재바인딩 없이 in-place 변경(append/pop/get)만.
main·generator가 같은 컨테이너 객체를 공유하므로 어느 모듈에서 변경해도 즉시 반영됨.
config·core·main에 무의존(순환 import 없음).
※ 리팩토링으로 main.py에서 이동 — 정의 byte-동일."""
import asyncio
from typing import List, Dict

# [Admin Dashboard] 실시간 추적용 전역 변수
tps_history: List[float] = []
live_queries: List[Dict[str, str]] = []

# --- 인덱싱 상태 저장소 ---
indexing_tasks: Dict[str, dict] = {}
# 동시 인덱싱 작업 수 제한(temp-upload·프로젝트 인덱싱 공유). 재바인딩 없음.
indexing_semaphore = asyncio.Semaphore(2)

# [벤치마크용] 청크 크기 설정 (admin chunk-config 엔드포인트 ↔ reindex 처리 공유, in-place 변경)
chunk_config: dict = {"parent_size": 1500, "child_size": 300, "parent_overlap": 150, "child_overlap": 40}
