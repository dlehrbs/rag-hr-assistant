"""[schemas] API 요청/응답 Pydantic 모델. 순수 데이터(앱 상태 무결합).
※ 리팩토링으로 main.py에서 이동 — 정의 동일."""
from typing import Optional, List
from pydantic import BaseModel


class FeedbackRequest(BaseModel):
    message_id: str
    question: str
    answer: str
    score: int
    sources: Optional[str] = None
    comment: Optional[str] = None

class SwitchModelRequest(BaseModel):
    model: str

class ConvCreateRequest(BaseModel):
    id: str
    title: str = "새로운 채팅"
    is_pinned: bool = False
    updated_at: Optional[str] = None
    project_id: Optional[str] = None      # 프로젝트 공간 대화 연결 (일반 대화는 None)

class ConvUpdateRequest(BaseModel):
    title: Optional[str] = None
    is_pinned: Optional[bool] = None
    updated_at: Optional[str] = None
    project_id: Optional[str] = None        # 프로젝트 이동 대상 (None 설정은 set_project_id로 구분)
    set_project_id: bool = False            # True면 project_id 값으로 갱신(프로젝트에서 제거 시 None)

class MsgSaveRequest(BaseModel):
    id: str
    role: str
    content: str
    timestamp: int                        # Unix ms
    files: Optional[List[str]] = None
    thought_steps: Optional[List[str]] = None
    is_aborted: bool = False
    feedback: Optional[int] = None

class MsgPatchRequest(BaseModel):
    feedback: Optional[int] = None
    content: Optional[str] = None
    is_aborted: Optional[bool] = None
    thought_steps: Optional[List[str]] = None

class RagTestRequest(BaseModel):
    query: str
    # 테스트 전용 파라미터 (미지정 시 RAGManager.search_params 사용)
    vector_k:    Optional[int] = None
    bm25_k:      Optional[int] = None
    final_top_k: Optional[int] = None
    mode:        Optional[str] = None

class SearchParamsRequest(BaseModel):
    vector_k:    Optional[int] = None
    bm25_k:      Optional[int] = None
    final_top_k: Optional[int] = None
    mode:        Optional[str] = None
    rerank_threshold: Optional[float] = None

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    password: str

class ChatRequest(BaseModel):
    query: str
    file_id: Optional[str] = None
    project_id: Optional[str] = None    # 프로젝트 공간 채팅 (업로드 파일만 검색)
    history: Optional[List[dict]] = []  # [{role: "user", content: "..."}, ...]
    user_profile: Optional[str] = ""    # 사용자의 개인 맞춤형 지침
    mode: str = "fast"
    web_search: bool = False            # 웹 검색 활성화 여부
    answer_mode: str = "regulation"     # 답변 모드: regulation(사내규정 RAG·기본) | general(범용 자유 답변)

class GlobalInstructionRequest(BaseModel):
    instruction: str = ""

class VerifyPasswordRequest(BaseModel):
    password: str

class ProjectCreateRequest(BaseModel):
    id: str
    name: Optional[str] = "새 프로젝트"
    description: Optional[str] = ""

class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_starred: Optional[bool] = None
    archived: Optional[bool] = None
    instruction: Optional[str] = None

class MemberInviteRequest(BaseModel):
    username: str                    # 초대할 사번/아이디
    role: str = "editor"             # 'editor' | 'viewer'

class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "user"

class ChangeRoleRequest(BaseModel):
    role: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

class AdminResetPasswordRequest(BaseModel):
    new_password: str

class ToggleActiveRequest(BaseModel):
    is_active: bool
