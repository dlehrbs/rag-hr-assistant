"""[db] SQLite 초기화·질의로그·행 변환 헬퍼. FEEDBACK_DB(config) 사용.
※ init_user_db는 RAGManager 결합이라 코어 세션에서 이관 예정. 리팩토링 이동 — 정의 동일."""
import sqlite3
import logging
from typing import Optional
from config import FEEDBACK_DB

logger = logging.getLogger(__name__)


def init_feedback_db():
    """피드백 데이터베이스 초기화 [RLHF-01]"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS feedbacks (
                id TEXT PRIMARY KEY,
                question TEXT,
                answer TEXT,
                score INTEGER,
                sources TEXT,
                comment TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS zero_hits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS query_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT NOT NULL,
                username TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # [마이그레이션] 기존 DB에 username/관제 컬럼이 없으면 추가
        try:
            _cols = [r[1] for r in cursor.execute("PRAGMA table_info(query_logs)")]
            if "username" not in _cols:
                cursor.execute("ALTER TABLE query_logs ADD COLUMN username TEXT")
                logger.info("🔧 [마이그레이션] query_logs.username 컬럼 추가")
            # [관제] 응답시간(ms)·처리상태 — latency p50/p95·에러율 산출용
            if "latency_ms" not in _cols:
                cursor.execute("ALTER TABLE query_logs ADD COLUMN latency_ms INTEGER")
                logger.info("🔧 [마이그레이션] query_logs.latency_ms 컬럼 추가")
            if "status" not in _cols:
                cursor.execute("ALTER TABLE query_logs ADD COLUMN status TEXT")
                logger.info("🔧 [마이그레이션] query_logs.status 컬럼 추가")
        except Exception as _me:
            logger.warning(f"query_logs 마이그레이션 실패: {_me}")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS doc_access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_file TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # ── 대화 기록 서버 저장 (계정별, 기기 무관) ──────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '새로운 채팅',
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conv_messages (
                id TEXT PRIMARY KEY,
                conv_id TEXT NOT NULL,
                username TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                files_json TEXT DEFAULT NULL,
                thought_steps_json TEXT DEFAULT NULL,
                is_aborted INTEGER NOT NULL DEFAULT 0,
                feedback INTEGER DEFAULT NULL,
                msg_timestamp INTEGER NOT NULL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_convs_user ON conversations(username, updated_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_msgs_conv ON conv_messages(conv_id, msg_timestamp)")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_rt_username ON refresh_tokens(username)")
        # ── 개인 파일 업로드 프로젝트 공간 (NotebookLM/Claude Project 스타일) ──────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '새 프로젝트',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS project_files (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                username TEXT NOT NULL,
                filename TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'indexing',
                chunks_count INTEGER DEFAULT 0,
                error TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(username, updated_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_pfiles_proj ON project_files(project_id)")
        # 프로젝트 공동작업 멤버 (소유자는 projects.username으로 판정, 여기엔 초대된 사람만)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS project_members (
                project_id TEXT NOT NULL,
                username TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'editor',   -- 'editor' | 'viewer'
                invited_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (project_id, username)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_pmembers_user ON project_members(username)")
        # 앱 전역 설정 (key-value) — 전역 관리자 지침 등 영속 저장
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        # 앱 내 알림 (프로젝트 초대 등)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                type TEXT NOT NULL,
                project_id TEXT,
                message TEXT,
                read_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(username, read_at)")
        try:
            cursor.execute("ALTER TABLE feedbacks ADD COLUMN comment TEXT")
        except:
            pass
        # 프로젝트별 대화 분리용 컬럼 (기존 일반 대화는 NULL)
        try:
            cursor.execute("ALTER TABLE conversations ADD COLUMN project_id TEXT DEFAULT NULL")
        except:
            pass
        # 프로젝트 메타 컬럼 (설명·별표·보관) + 파일 인덱싱 진행률 — 멱등 ALTER
        for _ddl in (
            "ALTER TABLE projects ADD COLUMN description TEXT DEFAULT ''",
            "ALTER TABLE projects ADD COLUMN is_starred INTEGER DEFAULT 0",
            "ALTER TABLE projects ADD COLUMN archived INTEGER DEFAULT 0",
            "ALTER TABLE project_files ADD COLUMN progress INTEGER DEFAULT 0",
            "ALTER TABLE project_files ADD COLUMN stage TEXT DEFAULT ''",
            "ALTER TABLE projects ADD COLUMN instruction TEXT DEFAULT ''",
        ):
            try:
                cursor.execute(_ddl)
            except:
                pass
        conn.commit()
        conn.close()
        logger.info(f"✅ 피드백 DB 초기화 완료: {FEEDBACK_DB}")
    except Exception as e:
        logger.error(f"❌ 피드백 DB 초기화 실패: {e}")

def _qlog_start(query: str, username: str) -> Optional[int]:
    """[관제] 질의 진입 즉시 기록(누락 0). row id 반환 → 종료 시 latency/status 갱신."""
    try:
        _c = sqlite3.connect(FEEDBACK_DB)
        cur = _c.execute(
            "INSERT INTO query_logs (query, username, status) VALUES (?, ?, 'pending')",
            (query, username or None),
        )
        _c.commit()
        rid = cur.lastrowid
        _c.close()
        return rid
    except Exception:
        return None

def _qlog_finish(row_id: Optional[int], latency_ms: int, status: str) -> None:
    """[관제] 스트림 종료 시 응답시간·상태 확정(ok/disconnected/error)."""
    if row_id is None:
        return
    try:
        _c = sqlite3.connect(FEEDBACK_DB)
        _c.execute(
            "UPDATE query_logs SET latency_ms = ?, status = ? WHERE id = ?",
            (latency_ms, status, row_id),
        )
        _c.commit()
        _c.close()
    except Exception:
        pass

def _conv_row_to_dict(row) -> dict:
    return {
        "id": row[0], "title": row[1],
        "is_pinned": bool(row[2]), "updated_at": row[3],
        "created_at": row[4],
        "project_id": row[5] if len(row) > 5 else None,
    }

def _msg_row_to_dict(row) -> dict:
    return {
        "id": row[0], "conv_id": row[1], "role": row[2],
        "content": row[3],
        "files_json": row[4],
        "thought_steps_json": row[5],
        "is_aborted": bool(row[6]),
        "feedback": row[7],
        "msg_timestamp": row[8],
    }
