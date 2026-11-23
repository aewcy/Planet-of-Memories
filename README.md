# 记忆星球 · Planet of Memories

一片属于朋友与彼此的深空记忆星空。每一张照片都会化作一颗发光的星辰，围绕着中心主星缓缓旋转，也可以选择在外环深空中安静漂流；点开星辰，AI「记录者」会和你聊聊画面里的光影与故事，并将那一刻封存成拍立得批注。

## 功能特性

- **双层星空与主星系统**：支持个人私密星空与多人共享星系（通过邀请链接加入），中心主星可绑定专属照片与纪念日。
- **轨道旋转 / 外环漂流**：上传或编辑照片时可自由选择让星星在星系轨道内旋转，或在外环深空缓慢漂流。
- **远方星系跃迁**：其他可访问的星系会化作背景里的螺旋星系，双击（移动端轻点两次）即可跃迁切换。
- **拍立得堆叠与 AI「记录者」**：支持滚轮/左右切换或滑动浏览拍立得堆叠，支持多模态识图对话与「封存这一刻」批注生成。
- **桌面端与移动端自适应**：桌面端星光引力光标、鼠标视差、右键视角菜单；移动端支持单指拖拽视角、长按菜单、双步预览确认与手势滑动。

## 目录结构

```text
polaroid-chronicle/
├── backend/          # FastAPI + SQLite + 多模态 AI 接口
│   ├── app/
│   ├── .env.example
│   └── requirements.txt
└── frontend/         # React + TypeScript + Vite + Canvas 星空
```

## 快速部署（服务器生产环境）

当 `frontend/dist` 存在时，后端 FastAPI 会自动托管前端构建产物，**只需启动一个后端服务进程即可**。

### 1. 克隆仓库并配置环境变量

```bash
git clone https://github.com/aewcy/Planet-of-Memories.git
cd Planet-of-Memories/backend
cp .env.example .env
```

编辑 `backend/.env`，填入：
- `PASSCODE_MAP`：生日暗号映射（格式：`暗号:昵称:颜色`，逗号分隔）
- `ADMIN_PASSCODE`：后台管理暗号
- `AI_API_KEY`：Gemini 或其他 OpenAI 兼容多模态接口的 API Key（留空则进入预览模拟模式）
- `AI_BASE_URL` / `AI_MODEL`：默认使用 Gemini OpenAI 兼容接口与 `gemini-3-flash-preview`

### 2. 安装后端依赖

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. 构建前端静态文件

```bash
cd ../frontend
npm install
npm run build
```

### 4. 启动服务

```bash
cd ../backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

建议配合 `systemd`（或 `pm2` / `supervisor`）常驻运行，并用 Nginx 反向代理 `80/443` 端口（开启 HTTPS 后移动端剪贴板与体验最佳）。

## 本地开发

- 后端：`cd backend && python -m uvicorn app.main:app --reload --port 8000`
- 前端：`cd frontend && npm run dev`
