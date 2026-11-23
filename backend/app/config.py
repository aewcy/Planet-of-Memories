from pathlib import Path
from typing import Dict, List
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # 格式: 暗号:名字:颜色,暗号:名字:颜色 （用各自的生日作为暗号）
    passcode_map: str = "1124:寿星:#89b4fa,0724:我:#f6c177,0808:好友:#94e2d5"
    admin_passcode: str = "admin1123"
    sender_name: str = "我"

    ai_api_key: str = ""
    ai_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    ai_model: str = "gemini-2.5-flash"

    host: str = "0.0.0.0"
    port: int = 8000

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def users_by_passcode(self) -> Dict[str, Dict[str, str]]:
        mapping: Dict[str, Dict[str, str]] = {}
        for item in self.passcode_map.split(","):
            parts = [p.strip() for p in item.split(":")]
            if len(parts) >= 2 and parts[0]:
                code = parts[0]
                name = parts[1]
                color = parts[2] if len(parts) >= 3 and parts[2] else "#f6c177"
                mapping[code] = {"name": name, "color": color}
        return mapping

    @property
    def author_palette(self) -> List[Dict[str, str]]:
        return list(self.users_by_passcode.values())

    @property
    def uploads_dir(self) -> Path:
        path = BASE_DIR / "uploads"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def db_path(self) -> Path:
        data_dir = BASE_DIR / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir / "chronicle.db"

    @property
    def ai_enabled(self) -> bool:
        return bool(self.ai_api_key.strip())


settings = Settings()
