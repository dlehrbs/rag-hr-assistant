"""[routes/conversations] 대화·메시지 저장 CRUD(계정별) APIRouter.
main 무의존 — config·db·core.auth·schemas만 사용. main이 include_router로 등록.
※ 리팩토링으로 main.py에서 이동 — 엔드포인트 본문 byte-동일(@app→@router만)."""
import json
import sqlite3
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from config import FEEDBACK_DB
from db import _conv_row_to_dict, _msg_row_to_dict
from core.auth import get_current_user
from schemas import ConvCreateRequest, ConvUpdateRequest, MsgSaveRequest, MsgPatchRequest

router = APIRouter()


@router.get("/api/conversations")
async def list_conversations(username: str = Depends(get_current_user)):
    """사용자의 전체 대화 목록 + 메시지 반환"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        c = conn.cursor()
        c.execute(
            "SELECT id, title, is_pinned, updated_at, created_at, project_id FROM conversations "
            "WHERE username=? ORDER BY updated_at DESC",
            (username,)
        )
        convs = [_conv_row_to_dict(r) for r in c.fetchall()]
        for conv in convs:
            c.execute(
                "SELECT id, conv_id, role, content, files_json, thought_steps_json, "
                "is_aborted, feedback, msg_timestamp "
                "FROM conv_messages WHERE conv_id=? AND username=? ORDER BY msg_timestamp ASC",
                (conv["id"], username)
            )
            conv["messages"] = [_msg_row_to_dict(r) for r in c.fetchall()]
        conn.close()
        return convs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/conversations")
async def create_conversation(req: ConvCreateRequest, username: str = Depends(get_current_user)):
    """대화 생성 (idempotent — 이미 있으면 무시)"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        now_str = req.updated_at or datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        conn.execute(
            "INSERT OR IGNORE INTO conversations (id, username, title, is_pinned, updated_at, project_id) VALUES (?,?,?,?,?,?)",
            (req.id, username, req.title, int(req.is_pinned), now_str, req.project_id)
        )
        conn.commit()
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/conversations/{conv_id}")
async def update_conversation(conv_id: str, req: ConvUpdateRequest, username: str = Depends(get_current_user)):
    """대화 제목/핀/업데이트 시각 수정"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        c = conn.cursor()
        if req.title is not None:
            c.execute("UPDATE conversations SET title=? WHERE id=? AND username=?", (req.title, conv_id, username))
        if req.is_pinned is not None:
            c.execute("UPDATE conversations SET is_pinned=? WHERE id=? AND username=?", (int(req.is_pinned), conv_id, username))
        if req.updated_at is not None:
            c.execute("UPDATE conversations SET updated_at=? WHERE id=? AND username=?", (req.updated_at, conv_id, username))
        if req.set_project_id:
            # 프로젝트 이동/제거 (제거 시 project_id=None)
            c.execute("UPDATE conversations SET project_id=? WHERE id=? AND username=?", (req.project_id, conv_id, username))
        conn.commit()
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/conversations/all")
async def delete_all_conversations(username: str = Depends(get_current_user)):
    """사용자의 모든 대화 삭제"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.execute("DELETE FROM conv_messages WHERE username=?", (username,))
        conn.execute("DELETE FROM conversations WHERE username=?", (username,))
        conn.commit()
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/conversations/{conv_id}")
async def delete_conversation(conv_id: str, username: str = Depends(get_current_user)):
    """대화 1개 + 해당 메시지 삭제"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.execute("DELETE FROM conv_messages WHERE conv_id=? AND username=?", (conv_id, username))
        conn.execute("DELETE FROM conversations WHERE id=? AND username=?", (conv_id, username))
        conn.commit()
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/conversations/{conv_id}/messages")
async def save_message(conv_id: str, req: MsgSaveRequest, username: str = Depends(get_current_user)):
    """메시지 저장 (upsert). 대화가 없으면 자동 생성."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        c = conn.cursor()
        # 대화가 없으면 auto-create (레이스 컨디션 방지)
        c.execute("INSERT OR IGNORE INTO conversations (id, username, title) VALUES (?,?,?)",
                  (conv_id, username, "새로운 채팅"))
        # 메시지 upsert
        c.execute("""
            INSERT OR REPLACE INTO conv_messages
            (id, conv_id, username, role, content, files_json, thought_steps_json, is_aborted, feedback, msg_timestamp)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            req.id, conv_id, username, req.role, req.content,
            json.dumps(req.files, ensure_ascii=False) if req.files else None,
            json.dumps(req.thought_steps, ensure_ascii=False) if req.thought_steps else None,
            int(req.is_aborted), req.feedback, req.timestamp,
        ))
        # 대화 updated_at 갱신
        c.execute("UPDATE conversations SET updated_at=datetime('now','localtime') WHERE id=? AND username=?",
                  (conv_id, username))
        conn.commit()
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/api/conversations/{conv_id}/messages/{msg_id}")
async def patch_message(conv_id: str, msg_id: str, req: MsgPatchRequest, username: str = Depends(get_current_user)):
    """메시지 부분 수정 (피드백 등)"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        c = conn.cursor()
        if req.feedback is not None:
            c.execute("UPDATE conv_messages SET feedback=? WHERE id=? AND conv_id=? AND username=?",
                      (req.feedback, msg_id, conv_id, username))
        if req.content is not None:
            c.execute("UPDATE conv_messages SET content=? WHERE id=? AND conv_id=? AND username=?",
                      (req.content, msg_id, conv_id, username))
        if req.is_aborted is not None:
            c.execute("UPDATE conv_messages SET is_aborted=? WHERE id=? AND conv_id=? AND username=?",
                      (int(req.is_aborted), msg_id, conv_id, username))
        if req.thought_steps is not None:
            c.execute("UPDATE conv_messages SET thought_steps_json=? WHERE id=? AND conv_id=? AND username=?",
                      (json.dumps(req.thought_steps, ensure_ascii=False), msg_id, conv_id, username))
        conn.commit()
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/conversations/{conv_id}/messages/from/{msg_id}")
async def delete_messages_from(conv_id: str, msg_id: str, username: str = Depends(get_current_user)):
    """지정 메시지 포함, 이후 모든 메시지 삭제 (메시지 수정 후 재생성용)"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        c = conn.cursor()
        c.execute("SELECT msg_timestamp FROM conv_messages WHERE id=? AND conv_id=? AND username=?",
                  (msg_id, conv_id, username))
        row = c.fetchone()
        if row:
            c.execute("DELETE FROM conv_messages WHERE conv_id=? AND username=? AND msg_timestamp >= ?",
                      (conv_id, username, row[0]))
            conn.commit()
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
