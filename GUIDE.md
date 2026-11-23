# 食用指南 · Planet of Memories

## 目录结构

```text
.
├── backend/          # FastAPI + SQLite + 多模态 AI 接口
│   ├── app/
│   ├── .env.example
│   └── requirements.txt
├── frontend/         # React + TypeScript + Vite + Canvas 星空
├── Dockerfile
└── docker-compose.yml
```

## 快速部署（推荐：Docker Compose）

服务器安装好 Docker 与 Docker Compose 后，执行：

```bash
git clone https://github.com/aewcy/Planet-of-Memories.git
cd Planet-of-Memories
cp backend/.env.example backend/.env
```

编辑 `backend/.env`：
- `PASSCODE_MAP`：生日暗号映射（格式：`暗号:昵称:颜色`，英文逗号分隔）
- `ADMIN_PASSCODE`：后台管理暗号
- `AI_API_KEY`：Gemini 或其他 OpenAI 兼容多模态接口的 API Key（留空则进入预览模拟模式）
- `AI_BASE_URL` / `AI_MODEL`：默认使用 Gemini OpenAI 兼容接口与 `gemini-3-flash-preview`

启动容器：

```bash
docker compose up -d --build
```

- 默认监听 `8000` 端口（建议外层使用 Nginx 反向代理到 `80/443` 并开启 HTTPS）。
- 数据库（`backend/data`）与照片文件（`backend/uploads`）已通过卷挂载持久化到宿主机，更新代码后重新 `docker compose up -d --build` 不会丢失数据。

## 手动部署（不使用 Docker）

当 `frontend/dist` 存在时，后端 FastAPI 会自动托管前端构建产物：

```bash
# 1. 配置环境变量
cd backend
cp .env.example .env

# 2. 安装后端依赖
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. 打包前端
cd ../frontend
npm install
npm run build

# 4. 启动服务
cd ../backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 本地开发

- 后端：`cd backend && python -m uvicorn app.main:app --reload --port 8000`
- 前端：`cd frontend && npm run dev`
