import random
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .ai import generate_chat_reply, generate_initial_greeting, seal_memory_caption
from .config import settings
from .database import get_db, init_db

app = FastAPI(title="Starfield Polaroid Chronicle API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


app.mount("/uploads", StaticFiles(directory=str(settings.uploads_dir)), name="uploads")


def _resolve_user_profile(passcode: str, base_info: Dict[str, str]) -> Dict[str, object]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT display_name, color FROM user_profiles WHERE passcode = ?",
            (passcode,),
        ).fetchone()
    if row:
        return {
            "name": row["display_name"],
            "color": row["color"],
            "passcode": passcode,
            "is_admin": False,
            "needs_name_setup": False,
        }
    return {
        "name": base_info["name"],
        "color": base_info["color"],
        "passcode": passcode,
        "is_admin": False,
        "needs_name_setup": True,
    }


def _resolved_authors() -> List[Dict[str, str]]:
    users = settings.users_by_passcode
    with get_db() as conn:
        rows = conn.execute("SELECT passcode, display_name, color FROM user_profiles").fetchall()
    profiles = {r["passcode"]: {"name": r["display_name"], "color": r["color"]} for r in rows}
    result = []
    for code, info in users.items():
        if code in profiles:
            result.append(profiles[code])
        else:
            result.append(info)
    return result


def get_current_user(x_passcode: Optional[str] = Header(default=None)) -> Dict[str, object]:
    code = (x_passcode or "").strip()
    admin_code = settings.admin_passcode.strip()
    if admin_code and code == admin_code:
        return {
            "name": "管理员",
            "color": "#cba6f7",
            "passcode": code,
            "is_admin": True,
            "needs_name_setup": False,
        }

    users = settings.users_by_passcode
    if not users:
        return {
            "name": "朋友",
            "color": "#f6c177",
            "passcode": code,
            "is_admin": False,
            "needs_name_setup": False,
        }
    if code not in users:
        raise HTTPException(status_code=401, detail="生日暗号不对哦，再想想？")
    return _resolve_user_profile(code, users[code])


def _load_site_effects() -> dict:
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM site_settings").fetchall()
    raw = {r["key"]: r["value"] for r in rows}
    return {
        "allow_author_filter": raw.get("allow_author_filter", "true").lower() == "true",
        "gravity_strength": float(raw.get("gravity_strength", "1.0")),
        "nebula_opacity": float(raw.get("nebula_opacity", "1.0")),
        "gate_title": raw.get("gate_title", "点亮今夜的星"),
        "upload_label": raw.get("upload_label", "拾光入星"),
    }


def _get_user_clusters(passcode: str, is_admin: bool) -> List[dict]:
    users_map = settings.users_by_passcode
    with get_db() as conn:
        profile_rows = conn.execute(
            "SELECT passcode, display_name, color FROM user_profiles"
        ).fetchall()
        profiles = {
            r["passcode"]: {"name": r["display_name"], "color": r["color"]}
            for r in profile_rows
        }
        if is_admin:
            rows = conn.execute(
                "SELECT id, name, invite_code, is_active FROM clusters ORDER BY id ASC"
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT c.id, c.name, c.invite_code, c.is_active
                FROM clusters c
                INNER JOIN cluster_members cm ON cm.cluster_id = c.id
                WHERE cm.passcode = ?
                ORDER BY c.id ASC
                """,
                (passcode,),
            ).fetchall()
        member_rows = conn.execute(
            "SELECT cluster_id, passcode FROM cluster_members"
        ).fetchall()

    members_by_cluster: Dict[int, List[dict]] = {}
    for m in member_rows:
        cid = m["cluster_id"]
        pc = m["passcode"]
        uinfo = profiles.get(pc) or users_map.get(pc, {"name": pc, "color": "#f6c177"})
        members_by_cluster.setdefault(cid, []).append(
            {"name": uinfo["name"], "color": uinfo["color"]}
        )

    return [
        {
            "id": r["id"],
            "name": r["name"],
            "invite_code": r["invite_code"],
            "is_active": bool(r["is_active"]),
            "members": members_by_cluster.get(r["id"], []),
        }
        for r in rows
    ]


def _ensure_cluster_access(cluster_id: int, user: Dict[str, object]) -> None:
    if cluster_id == 0 or user.get("is_admin"):
        return
    with get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM cluster_members WHERE cluster_id = ? AND passcode = ?",
            (cluster_id, str(user.get("passcode", ""))),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="你还未受邀加入这个星群")


def _ensure_photo_access(row, user: Dict[str, object]) -> None:
    if user.get("is_admin"):
        return
    if row["cluster_id"] == 0:
        if row["author_passcode"] != str(user.get("passcode", "")):
            raise HTTPException(status_code=403, detail="这是别人的私密星空照片哦")
        return
    _ensure_cluster_access(row["cluster_id"], user)


class AuthRequest(BaseModel):
    passcode: str
    invite_code: Optional[str] = None


class ChatRequest(BaseModel):
    message: str


class PhotoUpdateRequest(BaseModel):
    caption: Optional[str] = None
    taken_at: Optional[str] = None
    is_sealed: Optional[bool] = None
    in_orbit: Optional[bool] = None


class SiteEffectsUpdateRequest(BaseModel):
    allow_author_filter: Optional[bool] = None
    gravity_strength: Optional[float] = None
    nebula_opacity: Optional[float] = None
    gate_title: Optional[str] = None
    upload_label: Optional[str] = None


class ClusterCreateRequest(BaseModel):
    name: str


class ClusterUpdateRequest(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class ProfileNameRequest(BaseModel):
    name: str


def _row_to_photo(row) -> dict:
    return {
        "id": row["id"],
        "cluster_id": row["cluster_id"],
        "filename": row["filename"],
        "url": f"/uploads/{row['filename']}",
        "caption": row["caption"],
        "taken_at": row["taken_at"],
        "created_at": row["created_at"],
        "is_sealed": bool(row["is_sealed"]),
        "in_orbit": bool(row["in_orbit"]) if "in_orbit" in row.keys() else True,
        "tilt": row["tilt"],
        "author_name": row["author_name"],
        "author_color": row["author_color"],
        "message_count": row["message_count"] if "message_count" in row.keys() else 0,
    }


@app.get("/api/config")
def get_public_config() -> dict:
    return {
        "requires_passcode": bool(settings.users_by_passcode or settings.admin_passcode.strip()),
        "authors": _resolved_authors(),
        "sender_name": settings.sender_name,
        "ai_enabled": settings.ai_enabled,
        "effects": _load_site_effects(),
    }


@app.get("/api/invite/{invite_code}")
def get_invite_info(invite_code: str) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name, invite_code, is_active FROM clusters WHERE invite_code = ?",
            (invite_code.strip(),),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="找不到这个星群邀请")
    if not row["is_active"]:
        raise HTTPException(status_code=410, detail="这个星群邀请已关闭")
    return {
        "id": row["id"],
        "name": row["name"],
        "invite_code": row["invite_code"],
    }


@app.get("/api/stars")
def list_public_stars(invite_code: Optional[str] = None) -> list[dict]:
    """Return minimal star metadata for the ambient sky before unlocking."""
    if not invite_code:
        return []
    with get_db() as conn:
        cluster = conn.execute(
            "SELECT id FROM clusters WHERE invite_code = ? AND is_active = 1",
            (invite_code.strip(),),
        ).fetchone()
        if not cluster:
            return []
        rows = conn.execute(
            "SELECT id, taken_at, author_color FROM photos WHERE cluster_id = ? AND is_sun = 0 ORDER BY taken_at ASC, id ASC",
            (cluster["id"],),
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/auth")
def check_auth(body: AuthRequest) -> dict:
    code = body.passcode.strip()
    admin_code = settings.admin_passcode.strip()
    is_admin = bool(admin_code and code == admin_code)

    if is_admin:
        user = {
            "name": "管理员",
            "color": "#cba6f7",
            "is_admin": True,
            "needs_name_setup": False,
        }
    else:
        users = settings.users_by_passcode
        if not users:
            user = {
                "name": "朋友",
                "color": "#f6c177",
                "is_admin": False,
                "needs_name_setup": False,
            }
        elif code not in users:
            raise HTTPException(status_code=401, detail="生日暗号不对哦，再想想？")
        else:
            resolved = _resolve_user_profile(code, users[code])
            user = {
                "name": resolved["name"],
                "color": resolved["color"],
                "is_admin": False,
                "needs_name_setup": resolved["needs_name_setup"],
            }

    invited_cluster_id: Optional[int] = None
    if body.invite_code:
        with get_db() as conn:
            cluster = conn.execute(
                "SELECT id, is_active FROM clusters WHERE invite_code = ?",
                (body.invite_code.strip(),),
            ).fetchone()
            if cluster and cluster["is_active"]:
                invited_cluster_id = cluster["id"]
                if not is_admin:
                    conn.execute(
                        "INSERT OR IGNORE INTO cluster_members (cluster_id, passcode) VALUES (?, ?)",
                        (cluster["id"], code),
                    )
                    conn.commit()

    clusters = _get_user_clusters(code, is_admin)
    return {
        "ok": True,
        "user": user,
        "clusters": clusters,
        "invited_cluster_id": invited_cluster_id,
    }


@app.post("/api/profile/name")
def set_profile_name(
    body: ProfileNameRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="名字不能为空")
    passcode = str(user.get("passcode", ""))
    color = str(user.get("color", "#f6c177"))
    now_iso = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO user_profiles (passcode, display_name, color, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(passcode) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at
            """,
            (passcode, name, color, now_iso),
        )
        conn.execute(
            "UPDATE photos SET author_name = ? WHERE author_passcode = ?",
            (name, passcode),
        )
        conn.commit()

    return {
        "name": name,
        "color": color,
        "is_admin": bool(user.get("is_admin")),
        "needs_name_setup": False,
    }


@app.get("/api/clusters")
def list_my_clusters(user: Dict[str, object] = Depends(get_current_user)) -> list[dict]:
    """List clusters the current user belongs to, including members and invite code."""
    users_map = settings.users_by_passcode
    passcode = str(user.get("passcode", ""))
    is_admin = bool(user.get("is_admin"))

    with get_db() as conn:
        profile_rows = conn.execute("SELECT passcode, display_name, color FROM user_profiles").fetchall()
        profiles = {r["passcode"]: {"name": r["display_name"], "color": r["color"]} for r in profile_rows}
        if is_admin:
            clusters = conn.execute(
                """
                SELECT c.*, COUNT(p.id) AS photo_count
                FROM clusters c
                LEFT JOIN photos p ON p.cluster_id = c.id
                GROUP BY c.id
                ORDER BY c.id ASC
                """
            ).fetchall()
        else:
            clusters = conn.execute(
                """
                SELECT c.*, COUNT(p.id) AS photo_count
                FROM clusters c
                INNER JOIN cluster_members cm ON cm.cluster_id = c.id
                LEFT JOIN photos p ON p.cluster_id = c.id
                WHERE cm.passcode = ?
                GROUP BY c.id
                ORDER BY c.id ASC
                """,
                (passcode,),
            ).fetchall()
        member_rows = conn.execute(
            "SELECT cluster_id, passcode FROM cluster_members"
        ).fetchall()

    members_by_cluster: Dict[int, List[dict]] = {}
    for m in member_rows:
        cid = m["cluster_id"]
        pc = m["passcode"]
        uinfo = profiles.get(pc) or users_map.get(pc, {"name": pc, "color": "#f6c177"})
        members_by_cluster.setdefault(cid, []).append(
            {"name": uinfo["name"], "color": uinfo["color"]}
        )

    return [
        {
            "id": c["id"],
            "name": c["name"],
            "invite_code": c["invite_code"],
            "is_active": bool(c["is_active"]),
            "photo_count": c["photo_count"],
            "members": members_by_cluster.get(c["id"], []),
        }
        for c in clusters
    ]


@app.post("/api/clusters")
def create_my_cluster(
    body: ClusterCreateRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    """Allow any logged-in user to create a star cluster and auto-join it."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="星群名字不能为空")

    invite_code = secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8]
    now_iso = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    passcode = str(user.get("passcode", ""))

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO clusters (name, invite_code, is_active, created_at) VALUES (?, ?, 1, ?)",
            (name, invite_code, now_iso),
        )
        cid = cur.lastrowid
        if not user.get("is_admin") and passcode:
            conn.execute(
                "INSERT OR IGNORE INTO cluster_members (cluster_id, passcode) VALUES (?, ?)",
                (cid, passcode),
            )
        conn.commit()

    return {
        "id": cid,
        "name": name,
        "invite_code": invite_code,
        "is_active": True,
        "photo_count": 0,
        "members": [] if user.get("is_admin") else [{"name": str(user["name"]), "color": str(user["color"])}],
    }


@app.patch("/api/clusters/{cluster_id}")
def update_my_cluster(
    cluster_id: int,
    body: ClusterUpdateRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    _ensure_cluster_access(cluster_id, user)
    with get_db() as conn:
        row = conn.execute("SELECT * FROM clusters WHERE id = ?", (cluster_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到这个星群")
        new_name = body.name.strip() if body.name and body.name.strip() else row["name"]
        new_active = int(body.is_active) if body.is_active is not None else row["is_active"]
        conn.execute(
            "UPDATE clusters SET name = ?, is_active = ? WHERE id = ?",
            (new_name, new_active, cluster_id),
        )
        conn.commit()
    return {"id": cluster_id, "name": new_name, "is_active": bool(new_active)}


@app.get("/api/admin/clusters")
def list_admin_clusters(user: Dict[str, object] = Depends(get_current_user)) -> list[dict]:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")

    users_map = settings.users_by_passcode
    with get_db() as conn:
        profile_rows = conn.execute("SELECT passcode, display_name, color FROM user_profiles").fetchall()
        profiles = {r["passcode"]: {"name": r["display_name"], "color": r["color"]} for r in profile_rows}
        clusters = conn.execute(
            """
            SELECT c.*, COUNT(p.id) AS photo_count
            FROM clusters c
            LEFT JOIN photos p ON p.cluster_id = c.id
            GROUP BY c.id
            ORDER BY c.id ASC
            """
        ).fetchall()
        member_rows = conn.execute(
            "SELECT cluster_id, passcode FROM cluster_members"
        ).fetchall()

    members_by_cluster: Dict[int, List[dict]] = {}
    for m in member_rows:
        cid = m["cluster_id"]
        pc = m["passcode"]
        uinfo = profiles.get(pc) or users_map.get(pc, {"name": pc, "color": "#f6c177"})
        members_by_cluster.setdefault(cid, []).append(
            {"passcode": pc, "name": uinfo["name"], "color": uinfo["color"]}
        )

    return [
        {
            "id": c["id"],
            "name": c["name"],
            "invite_code": c["invite_code"],
            "is_active": bool(c["is_active"]),
            "photo_count": c["photo_count"],
            "members": members_by_cluster.get(c["id"], []),
        }
        for c in clusters
    ]


@app.post("/api/admin/clusters")
def create_admin_cluster(
    body: ClusterCreateRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="星群名字不能为空")

    invite_code = secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8]
    now_iso = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO clusters (name, invite_code, is_active, created_at) VALUES (?, ?, 1, ?)",
            (name, invite_code, now_iso),
        )
        cid = cur.lastrowid
        conn.commit()

    return {
        "id": cid,
        "name": name,
        "invite_code": invite_code,
        "is_active": True,
        "photo_count": 0,
        "members": [],
    }


@app.patch("/api/admin/clusters/{cluster_id}")
def update_admin_cluster(
    cluster_id: int,
    body: ClusterUpdateRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")

    with get_db() as conn:
        row = conn.execute("SELECT * FROM clusters WHERE id = ?", (cluster_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到这个星群")
        new_name = body.name.strip() if body.name and body.name.strip() else row["name"]
        new_active = int(body.is_active) if body.is_active is not None else row["is_active"]
        conn.execute(
            "UPDATE clusters SET name = ?, is_active = ? WHERE id = ?",
            (new_name, new_active, cluster_id),
        )
        conn.commit()
    return {"id": cluster_id, "name": new_name, "is_active": bool(new_active)}


@app.patch("/api/admin/settings")
def update_site_effects(
    body: SiteEffectsUpdateRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")

    updates = {}
    if body.allow_author_filter is not None:
        updates["allow_author_filter"] = "true" if body.allow_author_filter else "false"
    if body.gravity_strength is not None:
        updates["gravity_strength"] = str(max(0.2, min(2.5, body.gravity_strength)))
    if body.nebula_opacity is not None:
        updates["nebula_opacity"] = str(max(0.0, min(2.5, body.nebula_opacity)))
    if body.gate_title is not None and body.gate_title.strip():
        updates["gate_title"] = body.gate_title.strip()
    if body.upload_label is not None and body.upload_label.strip():
        updates["upload_label"] = body.upload_label.strip()

    if updates:
        with get_db() as conn:
            for k, v in updates.items():
                conn.execute(
                    "INSERT INTO site_settings (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (k, v),
                )
            conn.commit()

    return _load_site_effects()


def _sun_scope_key(cluster_id: int, user: Dict[str, object]) -> str:
    if cluster_id == 0:
        return f"user:{user.get('passcode', '')}"
    return f"cluster:{cluster_id}"


@app.get("/api/sun")
def get_sun_config(
    cluster_id: int = 0,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    _ensure_cluster_access(cluster_id, user)
    scope = _sun_scope_key(cluster_id, user)
    with get_db() as conn:
        cfg = conn.execute(
            "SELECT photo_id, met_at FROM sun_configs WHERE scope_key = ?",
            (scope,),
        ).fetchone()
        if not cfg:
            return {"met_at": "", "photo": None}
        photo_dict = None
        if cfg["photo_id"]:
            prow = conn.execute(
                """
                SELECT p.*, COUNT(m.id) AS message_count
                FROM photos p
                LEFT JOIN messages m ON m.photo_id = p.id
                WHERE p.id = ?
                GROUP BY p.id
                """,
                (cfg["photo_id"],),
            ).fetchone()
            if prow:
                msgs = conn.execute(
                    "SELECT id, role, content, created_at FROM messages WHERE photo_id = ? ORDER BY id ASC",
                    (cfg["photo_id"],),
                ).fetchall()
                photo_dict = _row_to_photo(prow)
                photo_dict["messages"] = [dict(m) for m in msgs]
    return {"met_at": cfg["met_at"], "photo": photo_dict}


@app.post("/api/sun")
async def save_sun_config(
    cluster_id: int = Form(default=0),
    met_at: str = Form(default=""),
    file: Optional[UploadFile] = File(default=None),
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    _ensure_cluster_access(cluster_id, user)
    scope = _sun_scope_key(cluster_id, user)
    now_iso = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    with get_db() as conn:
        existing = conn.execute(
            "SELECT photo_id, met_at FROM sun_configs WHERE scope_key = ?",
            (scope,),
        ).fetchone()
    photo_id = existing["photo_id"] if existing else None

    if file is not None and file.filename:
        ext = Path(file.filename).suffix.lower() or ".jpg"
        if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            ext = ".jpg"
        unique_name = f"sun_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}{ext}"
        dest_path = settings.uploads_dir / unique_name
        content = await file.read()
        dest_path.write_bytes(content)

        effective_taken = met_at.strip() or now_iso[:10]
        with get_db() as conn:
            cur = conn.execute(
                """
                INSERT INTO photos (
                    cluster_id, filename, caption, taken_at, created_at, is_sealed, tilt,
                    author_name, author_color, author_passcode, is_sun
                )
                VALUES (?, ?, '', ?, ?, 0, 0.0, ?, ?, ?, 1)
                """,
                (
                    cluster_id,
                    unique_name,
                    effective_taken,
                    now_iso,
                    str(user["name"]),
                    str(user["color"]),
                    str(user.get("passcode", "")),
                ),
            )
            photo_id = cur.lastrowid
            conn.commit()

        greeting = await generate_initial_greeting(dest_path, [])
        with get_db() as conn:
            conn.execute(
                "INSERT INTO messages (photo_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)",
                (photo_id, greeting, now_iso),
            )
            conn.commit()

    clean_met = met_at.strip()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO sun_configs (scope_key, photo_id, met_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(scope_key) DO UPDATE SET
                photo_id = COALESCE(excluded.photo_id, sun_configs.photo_id),
                met_at = excluded.met_at,
                updated_at = excluded.updated_at
            """,
            (scope, photo_id, clean_met, now_iso),
        )
        if photo_id and clean_met:
            conn.execute(
                "UPDATE photos SET taken_at = ? WHERE id = ?",
                (clean_met, photo_id),
            )
        conn.commit()

    return get_sun_config(cluster_id=cluster_id, user=user)


@app.get("/api/photos")
def list_photos(
    cluster_id: int = 0,
    order: str = "asc",
    user: Dict[str, object] = Depends(get_current_user),
) -> list[dict]:
    _ensure_cluster_access(cluster_id, user)
    sort_dir = "DESC" if order.lower() == "desc" else "ASC"
    with get_db() as conn:
        if cluster_id == 0 and not user.get("is_admin"):
            rows = conn.execute(
                f"""
                SELECT p.*, COUNT(m.id) AS message_count
                FROM photos p
                LEFT JOIN messages m ON m.photo_id = p.id
                WHERE p.cluster_id = 0 AND p.author_passcode = ? AND p.is_sun = 0
                GROUP BY p.id
                ORDER BY p.taken_at {sort_dir}, p.id {sort_dir}
                """,
                (str(user.get("passcode", "")),),
            ).fetchall()
        else:
            rows = conn.execute(
                f"""
                SELECT p.*, COUNT(m.id) AS message_count
                FROM photos p
                LEFT JOIN messages m ON m.photo_id = p.id
                WHERE p.cluster_id = ? AND p.is_sun = 0
                GROUP BY p.id
                ORDER BY p.taken_at {sort_dir}, p.id {sort_dir}
                """,
                (cluster_id,),
            ).fetchall()
    return [_row_to_photo(r) for r in rows]


@app.post("/api/photos")
async def upload_photo(
    file: UploadFile = File(...),
    cluster_id: int = Form(default=0),
    taken_at: Optional[str] = Form(default=None),
    caption: str = Form(default=""),
    in_orbit: bool = Form(default=True),
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    _ensure_cluster_access(cluster_id, user)
    ext = Path(file.filename or "photo.jpg").suffix.lower() or ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        ext = ".jpg"

    unique_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}{ext}"
    dest_path = settings.uploads_dir / unique_name
    content = await file.read()
    dest_path.write_bytes(content)

    now_iso = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    effective_taken_at = (taken_at or "").strip() or now_iso[:16].replace("T", " ")
    tilt = round(random.uniform(-2.2, 2.2), 2)

    with get_db() as conn:
        recent_rows = conn.execute(
            "SELECT caption FROM photos WHERE cluster_id = ? AND is_sealed = 1 AND caption != '' ORDER BY id DESC LIMIT 5",
            (cluster_id,),
        ).fetchall()
        recent_captions = [r["caption"] for r in recent_rows]

        cur = conn.execute(
            """
            INSERT INTO photos (
                cluster_id, filename, caption, taken_at, created_at, is_sealed, tilt, author_name, author_color, author_passcode, in_orbit
            )
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
            """,
            (
                cluster_id,
                unique_name,
                caption.strip(),
                effective_taken_at,
                now_iso,
                tilt,
                str(user["name"]),
                str(user["color"]),
                str(user.get("passcode", "")),
                int(in_orbit),
            ),
        )
        photo_id = cur.lastrowid
        conn.commit()

    greeting = await generate_initial_greeting(dest_path, recent_captions)

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO messages (photo_id, role, content, created_at)
            VALUES (?, 'assistant', ?, ?)
            """,
            (photo_id, greeting, now_iso),
        )
        conn.commit()
        row = conn.execute(
            """
            SELECT p.*, COUNT(m.id) AS message_count
            FROM photos p
            LEFT JOIN messages m ON m.photo_id = p.id
            WHERE p.id = ?
            GROUP BY p.id
            """,
            (photo_id,),
        ).fetchone()
        msgs = conn.execute(
            "SELECT id, role, content, created_at FROM messages WHERE photo_id = ? ORDER BY id ASC",
            (photo_id,),
        ).fetchall()

    result = _row_to_photo(row)
    result["messages"] = [dict(m) for m in msgs]
    return result


@app.get("/api/photos/{photo_id}")
def get_photo_detail(
    photo_id: int,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT p.*, COUNT(m.id) AS message_count
            FROM photos p
            LEFT JOIN messages m ON m.photo_id = p.id
            WHERE p.id = ?
            GROUP BY p.id
            """,
            (photo_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到这张照片")
        _ensure_photo_access(row, user)
        msgs = conn.execute(
            "SELECT id, role, content, created_at FROM messages WHERE photo_id = ? ORDER BY id ASC",
            (photo_id,),
        ).fetchall()

    result = _row_to_photo(row)
    result["messages"] = [dict(m) for m in msgs]
    return result


@app.patch("/api/photos/{photo_id}")
def update_photo(
    photo_id: int,
    body: PhotoUpdateRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到这张照片")
        _ensure_photo_access(row, user)

        new_caption = body.caption if body.caption is not None else row["caption"]
        new_taken_at = body.taken_at if body.taken_at is not None else row["taken_at"]
        new_sealed = int(body.is_sealed) if body.is_sealed is not None else row["is_sealed"]
        new_in_orbit = int(body.in_orbit) if body.in_orbit is not None else row["in_orbit"]

        conn.execute(
            "UPDATE photos SET caption = ?, taken_at = ?, is_sealed = ?, in_orbit = ? WHERE id = ?",
            (new_caption.strip(), new_taken_at.strip(), new_sealed, new_in_orbit, photo_id),
        )
        conn.commit()
        updated = conn.execute(
            """
            SELECT p.*, COUNT(m.id) AS message_count
            FROM photos p
            LEFT JOIN messages m ON m.photo_id = p.id
            WHERE p.id = ?
            GROUP BY p.id
            """,
            (photo_id,),
        ).fetchone()

    return _row_to_photo(updated)


@app.delete("/api/photos/{photo_id}")
def delete_photo(
    photo_id: int,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT cluster_id, author_passcode, filename FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到这张照片")
        _ensure_photo_access(row, user)
        file_path = settings.uploads_dir / row["filename"]
        conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
        conn.commit()

    if file_path.exists():
        file_path.unlink(missing_ok=True)
    return {"ok": True}


@app.post("/api/photos/{photo_id}/chat")
async def chat_about_photo(
    photo_id: int,
    body: ChatRequest,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="消息不能为空")

    now_iso = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    with get_db() as conn:
        row = conn.execute("SELECT cluster_id, author_passcode, filename FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到这张照片")
        _ensure_photo_access(row, user)

        conn.execute(
            "INSERT INTO messages (photo_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
            (photo_id, text, now_iso),
        )
        conn.commit()

        history_rows = conn.execute(
            "SELECT role, content FROM messages WHERE photo_id = ? ORDER BY id ASC",
            (photo_id,),
        ).fetchall()
        recent_rows = conn.execute(
            "SELECT caption FROM photos WHERE cluster_id = ? AND is_sealed = 1 AND id != ? AND caption != '' ORDER BY id DESC LIMIT 5",
            (row["cluster_id"], photo_id),
        ).fetchall()

    history = [{"role": r["role"], "content": r["content"]} for r in history_rows]
    recent_captions = [r["caption"] for r in recent_rows]
    image_path = settings.uploads_dir / row["filename"]

    reply = await generate_chat_reply(image_path, history, recent_captions)
    reply_iso = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO messages (photo_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)",
            (photo_id, reply, reply_iso),
        )
        conn.commit()
        msg_id = cur.lastrowid

    return {
        "id": msg_id,
        "role": "assistant",
        "content": reply,
        "created_at": reply_iso,
    }


@app.post("/api/photos/{photo_id}/seal")
async def seal_photo(
    photo_id: int,
    user: Dict[str, object] = Depends(get_current_user),
) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到这张照片")
        _ensure_photo_access(row, user)
        history_rows = conn.execute(
            "SELECT role, content FROM messages WHERE photo_id = ? ORDER BY id ASC",
            (photo_id,),
        ).fetchall()

    history = [{"role": r["role"], "content": r["content"]} for r in history_rows]
    image_path = settings.uploads_dir / row["filename"]
    caption = await seal_memory_caption(image_path, history, row["taken_at"])

    with get_db() as conn:
        conn.execute(
            "UPDATE photos SET caption = ?, is_sealed = 1 WHERE id = ?",
            (caption, photo_id),
        )
        conn.commit()
        updated = conn.execute(
            """
            SELECT p.*, COUNT(m.id) AS message_count
            FROM photos p
            LEFT JOIN messages m ON m.photo_id = p.id
            WHERE p.id = ?
            GROUP BY p.id
            """,
            (photo_id,),
        ).fetchone()

    return _row_to_photo(updated)


# Serve built frontend in production when frontend/dist exists
_FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _FRONTEND_DIST.is_dir():
    _assets_dir = _FRONTEND_DIST / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="frontend-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend_spa(full_path: str):
        if full_path.startswith("api/") or full_path == "api" or full_path.startswith("uploads/"):
            raise HTTPException(status_code=404, detail="Not Found")
        if full_path:
            target = (_FRONTEND_DIST / full_path).resolve()
            dist_root = _FRONTEND_DIST.resolve()
            if dist_root in target.parents and target.is_file():
                return FileResponse(target)
        index_file = _FRONTEND_DIST / "index.html"
        if index_file.is_file():
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail="Frontend not built")
