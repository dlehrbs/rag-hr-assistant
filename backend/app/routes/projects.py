"""[routes/projects] 프로젝트 공간 API — 프로젝트 CRUD·파일 업로드/삭제·멤버 초대/권한·알림·사용자검색. APIRouter.
config·core.auth·schemas·projects_logic에 의존(로직은 projects_logic, 여기는 HTTP 계층).
※ 리팩토링으로 main.py에서 이동 — 엔드포인트 본문 byte-동일(@app→@router만)."""
import os
import uuid
import shutil
import asyncio
import sqlite3
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks

from config import FEEDBACK_DB, PROJECT_DB_ROOT
from core.auth import get_current_user
from schemas import ProjectCreateRequest, ProjectUpdateRequest, MemberInviteRequest
from projects_logic import (
    _get_project_lock, _project_members_list, _require_project_access,
    index_file_into_project, remove_file_from_project, project_retrievers,
)

logger = logging.getLogger("main")

router = APIRouter()

# 프로젝트 파일 업로드 제한 (main.py에서 이동)
PROJECT_FILE_MAX_BYTES = 100 * 1024 * 1024  # 100MB
PROJECT_FILE_MAX_COUNT = 50


@router.get("/api/projects")
async def list_projects(username: str = Depends(get_current_user)):
    """내가 소유하거나 멤버로 초대된 프로젝트 목록 + 파일·멤버·내 역할."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        c = conn.cursor()
        # 소유 프로젝트(role=owner) + 초대받은 프로젝트(멤버 role)
        rows = c.execute(
            "SELECT id, name, created_at, updated_at, description, is_starred, archived, instruction, 'owner' AS myrole "
            "FROM projects WHERE username=? "
            "UNION "
            "SELECT p.id, p.name, p.created_at, p.updated_at, p.description, p.is_starred, p.archived, p.instruction, m.role AS myrole "
            "FROM projects p JOIN project_members m ON p.id=m.project_id WHERE m.username=? "
            "ORDER BY is_starred DESC, updated_at DESC",
            (username, username)
        ).fetchall()
        projects = []
        for pid, name, created, updated, desc, starred, archived, instr, myrole in rows:
            files = [{"id": r[0], "filename": r[1], "status": r[2], "chunks_count": r[3], "error": r[4], "created_at": r[5]}
                     for r in c.execute("SELECT id, filename, status, chunks_count, error, created_at FROM project_files WHERE project_id=? ORDER BY created_at ASC", (pid,)).fetchall()]
            members = _project_members_list(conn, pid)
            projects.append({"id": pid, "name": name, "created_at": created, "updated_at": updated,
                             "description": desc or "", "is_starred": bool(starred), "archived": bool(archived),
                             "instruction": instr or "",
                             "files": files, "my_role": myrole, "shared": len(members) > 1, "members": members})
        conn.close()
        return projects
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/projects")
async def create_project(req: ProjectCreateRequest, username: str = Depends(get_current_user)):
    """프로젝트 생성 (idempotent)."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.execute("INSERT OR IGNORE INTO projects (id, username, name, description) VALUES (?,?,?,?)",
                     (req.id, username, req.name or "새 프로젝트", req.description or ""))
        conn.commit()
        conn.close()
        return {"ok": True, "id": req.id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/projects/{project_id}")
async def update_project(project_id: str, req: ProjectUpdateRequest, username: str = Depends(get_current_user)):
    """프로젝트 부분 수정 (이름·설명·별표·보관) — 소유자만."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        _require_project_access(conn, project_id, username, need="owner")
        sets, vals = [], []
        if req.name is not None:        sets.append("name=?");        vals.append(req.name)
        if req.description is not None: sets.append("description=?"); vals.append(req.description)
        if req.is_starred is not None:  sets.append("is_starred=?");  vals.append(int(req.is_starred))
        if req.archived is not None:    sets.append("archived=?");    vals.append(int(req.archived))
        if req.instruction is not None: sets.append("instruction=?"); vals.append(req.instruction[:1500])  # 서버 강제 cap
        if sets:
            sets.append("updated_at=datetime('now','localtime')")
            conn.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id=? AND username=?", (*vals, project_id, username))
            conn.commit()
        conn.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/projects/{project_id}")
async def delete_project(project_id: str, username: str = Depends(get_current_user)):
    """프로젝트 + 파일 + 인덱스 디렉터리 + 연결된 대화 삭제."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        _require_project_access(conn, project_id, username, need="owner")
        # 공유 프로젝트: 모든 멤버의 파일·대화까지 일괄 정리 (project_id 기준)
        conn.execute("DELETE FROM project_files WHERE project_id=?", (project_id,))
        conn.execute("DELETE FROM project_members WHERE project_id=?", (project_id,))
        conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
        rows = conn.execute("SELECT id FROM conversations WHERE project_id=?", (project_id,)).fetchall()
        for (cid,) in rows:
            conn.execute("DELETE FROM conv_messages WHERE conv_id=?", (cid,))
        conn.execute("DELETE FROM conversations WHERE project_id=?", (project_id,))
        conn.commit()
        conn.close()
        # 인덱스 디렉터리·캐시 정리
        project_retrievers.pop(project_id, None)
        shutil.rmtree(os.path.join(PROJECT_DB_ROOT, project_id), ignore_errors=True)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/projects/{project_id}/files")
async def upload_project_file(project_id: str, file: UploadFile = File(...), mode: str = "fast",
                              background_tasks: BackgroundTasks = None, username: str = Depends(get_current_user)):
    """프로젝트에 파일 업로드 → 백그라운드 인덱싱 (PDF/txt/md/html/docx/xlsx/pptx)."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".pdf", ".txt", ".md", ".html", ".htm", ".docx", ".xlsx", ".xls", ".pptx"):
        raise HTTPException(status_code=400, detail="지원 형식: PDF, txt, md, html, docx, xlsx, pptx")
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        _require_project_access(conn, project_id, username, need="edit")
        file_count = conn.execute("SELECT COUNT(*) FROM project_files WHERE project_id=?", (project_id,)).fetchone()[0]
        if file_count >= PROJECT_FILE_MAX_COUNT:
            conn.close()
            raise HTTPException(status_code=400, detail=f"프로젝트당 파일은 최대 {PROJECT_FILE_MAX_COUNT}개까지 업로드할 수 있습니다.")
        content = await file.read()
        if len(content) > PROJECT_FILE_MAX_BYTES:
            conn.close()
            raise HTTPException(status_code=413, detail=f"파일 용량은 최대 {PROJECT_FILE_MAX_BYTES // (1024*1024)}MB까지 업로드할 수 있습니다.")
        file_id = str(uuid.uuid4())
        conn.execute("INSERT INTO project_files (id, project_id, username, filename, status) VALUES (?,?,?,?,'indexing')",
                     (file_id, project_id, username, file.filename))
        conn.execute("UPDATE projects SET updated_at=datetime('now','localtime') WHERE id=?", (project_id,))
        conn.commit()
        conn.close()
        background_tasks.add_task(index_file_into_project, project_id, file_id, file.filename, content, mode)
        return {"file_id": file_id, "status": "indexing"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/projects/{project_id}/files/status/{file_id}")
async def project_file_status(project_id: str, file_id: str, username: str = Depends(get_current_user)):
    """파일 인덱싱 상태 조회 (멤버 누구나)."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        _require_project_access(conn, project_id, username, need="view")
        row = conn.execute("SELECT status, chunks_count, error, progress, stage FROM project_files WHERE id=? AND project_id=?",
                           (file_id, project_id)).fetchone()
        conn.close()
        if not row:
            raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
        return {"status": row[0], "chunks_count": row[1], "error": row[2],
                "progress": row[3] or 0, "stage": row[4] or ""}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/projects/{project_id}/files/{file_id}")
async def delete_project_file(project_id: str, file_id: str, username: str = Depends(get_current_user)):
    """파일 제거 + 인덱스에서 해당 파일 청크만 정리 (편집자 이상)."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        _require_project_access(conn, project_id, username, need="edit")
        conn.execute("DELETE FROM project_files WHERE id=? AND project_id=?", (file_id, project_id))
        conn.commit()
        conn.close()
        # 인덱싱과 동일 프로젝트 락으로 직렬화 (parent_map.pkl 경합 방지)
        async with _get_project_lock(project_id):
            await asyncio.to_thread(remove_file_from_project, project_id, file_id)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/projects/{project_id}/members")
async def list_project_members(project_id: str, username: str = Depends(get_current_user)):
    """멤버 목록 조회 (멤버 누구나)."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        _require_project_access(conn, project_id, username, need="view")
        members = _project_members_list(conn, project_id)
        conn.close()
        return {"members": members}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/projects/{project_id}/members")
async def invite_project_member(project_id: str, req: MemberInviteRequest, username: str = Depends(get_current_user)):
    """멤버 초대/역할변경 (소유자만). 사번이 아직 미접속이어도 등록 — 첫 입장 시 자동 연결."""
    target = (req.username or "").strip()
    role = req.role if req.role in ("editor", "viewer") else "editor"
    if not target:
        raise HTTPException(status_code=400, detail="초대할 사번/아이디를 입력하세요.")
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        _require_project_access(conn, project_id, username, need="owner")
        owner = conn.execute("SELECT username FROM projects WHERE id=?", (project_id,)).fetchone()
        if owner and owner[0] == target:
            raise HTTPException(status_code=400, detail="이미 소유자입니다.")
        # upsert (이미 멤버면 역할만 갱신)
        conn.execute(
            "INSERT INTO project_members (project_id, username, role, invited_by) VALUES (?,?,?,?) "
            "ON CONFLICT(project_id, username) DO UPDATE SET role=excluded.role",
            (project_id, target, role, username)
        )
        proj_name = conn.execute("SELECT name FROM projects WHERE id=?", (project_id,)).fetchone()
        # 같은 사용자·프로젝트의 '미확인' 초대 알림이 이미 있으면 중복 생성하지 않음
        # (초대 버튼 더블클릭·역할변경 재호출 등으로 알림이 쌓이는 것 방지)
        dup = conn.execute(
            "SELECT 1 FROM notifications WHERE username=? AND project_id=? AND type='project_invite' AND read_at IS NULL LIMIT 1",
            (target, project_id)
        ).fetchone()
        if not dup:
            conn.execute(
                "INSERT INTO notifications (id, username, type, project_id, message) VALUES (?,?,?,?,?)",
                (str(uuid.uuid4()), target, "project_invite", project_id,
                 f"{username}님이 '{(proj_name[0] if proj_name else '프로젝트')}' 프로젝트에 초대했습니다.")
            )
        conn.commit()
        # 표시용 이름 조회
        nm = conn.execute("SELECT display_name, dept FROM users WHERE username=?", (target,)).fetchone()
        conn.close()
        known = bool(nm)
        logger.info(f"👥 [프로젝트:{project_id[:8]}] 멤버 초대: {target}({role}) by {username}" + ("" if known else " — 미접속 사번(첫 입장 시 연결)"))
        return {"ok": True, "username": target, "role": role,
                "name": (nm[0] if nm and nm[0] else target), "known": known}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/projects/{project_id}/members/{member}")
async def remove_project_member(project_id: str, member: str, username: str = Depends(get_current_user)):
    """멤버 제거 (소유자만)."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        _require_project_access(conn, project_id, username, need="owner")
        conn.execute("DELETE FROM project_members WHERE project_id=? AND username=?", (project_id, member))
        conn.commit()
        conn.close()
        logger.info(f"👥 [프로젝트:{project_id[:8]}] 멤버 제거: {member} by {username}")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/notifications")
async def list_notifications(username: str = Depends(get_current_user)):
    """내 알림 목록 (최근 50건, 미확인 먼저)."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        rows = conn.execute(
            "SELECT id, type, project_id, message, read_at, created_at FROM notifications "
            "WHERE username=? ORDER BY read_at IS NOT NULL ASC, created_at DESC LIMIT 50",
            (username,)
        ).fetchall()
        unread = conn.execute(
            "SELECT COUNT(*) FROM notifications WHERE username=? AND read_at IS NULL", (username,)
        ).fetchone()[0]
        conn.close()
        items = [{"id": r[0], "type": r[1], "project_id": r[2], "message": r[3],
                  "read": bool(r[4]), "created_at": r[5]} for r in rows]
        return {"items": items, "unread_count": unread}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/api/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, username: str = Depends(get_current_user)):
    """알림 1건 읽음 처리 (본인 것만)."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.execute(
            "UPDATE notifications SET read_at=datetime('now','localtime') WHERE id=? AND username=?",
            (notif_id, username)
        )
        conn.commit()
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/notifications/read-all")
async def mark_all_notifications_read(username: str = Depends(get_current_user)):
    """전체 읽음 처리."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.execute(
            "UPDATE notifications SET read_at=datetime('now','localtime') WHERE username=? AND read_at IS NULL",
            (username,)
        )
        conn.commit()
        conn.close()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/users/search")
async def search_users(q: str = "", username: str = Depends(get_current_user)):
    """멤버 초대용 사용자 자동완성 — 접속 이력 있는 계정(users)을 사번/이름으로 검색."""
    q = (q or "").strip()
    if len(q) < 1:
        return {"users": []}
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        like = f"%{q}%"
        rows = conn.execute(
            "SELECT username, display_name, dept FROM users "
            "WHERE (username LIKE ? OR display_name LIKE ?) AND username != ? "
            "ORDER BY display_name LIMIT 8",
            (like, like, username)
        ).fetchall()
        conn.close()
        return {"users": [{"username": r[0], "name": (r[1] or r[0]), "dept": r[2]} for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
