import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

from .config import settings


def init_db() -> None:
    """Initialize SQLite tables, clusters, and migrate columns if needed."""
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS clusters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                invite_code TEXT NOT NULL UNIQUE,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cluster_members (
                cluster_id INTEGER NOT NULL,
                passcode TEXT NOT NULL,
                PRIMARY KEY (cluster_id, passcode),
                FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_id INTEGER NOT NULL DEFAULT 1,
                filename TEXT NOT NULL,
                caption TEXT NOT NULL DEFAULT '',
                taken_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                is_sealed INTEGER NOT NULL DEFAULT 0,
                tilt REAL NOT NULL DEFAULT 0.0,
                author_name TEXT NOT NULL DEFAULT '我',
                author_color TEXT NOT NULL DEFAULT '#f6c177'
            )
            """
        )
        cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(photos)").fetchall()
        }
        if "author_name" not in cols:
            conn.execute(
                "ALTER TABLE photos ADD COLUMN author_name TEXT NOT NULL DEFAULT '我'"
            )
        if "author_color" not in cols:
            conn.execute(
                "ALTER TABLE photos ADD COLUMN author_color TEXT NOT NULL DEFAULT '#f6c177'"
            )
        if "cluster_id" not in cols:
            conn.execute(
                "ALTER TABLE photos ADD COLUMN cluster_id INTEGER NOT NULL DEFAULT 1"
            )
        if "author_passcode" not in cols:
            conn.execute(
                "ALTER TABLE photos ADD COLUMN author_passcode TEXT NOT NULL DEFAULT ''"
            )
        if "is_sun" not in cols:
            conn.execute(
                "ALTER TABLE photos ADD COLUMN is_sun INTEGER NOT NULL DEFAULT 0"
            )
        if "in_orbit" not in cols:
            conn.execute(
                "ALTER TABLE photos ADD COLUMN in_orbit INTEGER NOT NULL DEFAULT 1"
            )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sun_configs (
                scope_key TEXT PRIMARY KEY,
                photo_id INTEGER,
                met_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE SET NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_profiles (
                passcode TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                color TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                photo_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS site_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        defaults = {
            "allow_author_filter": "true",
            "gravity_strength": "1.0",
            "nebula_opacity": "1.0",
            "gate_title": "点亮今夜的星",
            "upload_label": "拾光入星",
        }
        for k, v in defaults.items():
            conn.execute(
                "INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)",
                (k, v),
            )

        conn.commit()


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(settings.db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()
