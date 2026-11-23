import asyncio
import base64
import mimetypes
from pathlib import Path
from typing import List, Dict

import httpx

from .config import settings


def _encode_image_data_url(image_path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(str(image_path))
    if not mime_type:
        mime_type = "image/jpeg"
    raw = image_path.read_bytes()
    b64 = base64.b64encode(raw).decode("utf-8")
    return f"data:{mime_type};base64,{b64}"


def _build_system_prompt(recent_captions: List[str], speaker_name: str = "朋友") -> str:
    memory_context = ""
    if recent_captions:
        joined = "\n".join(f"- {c}" for c in recent_captions[:5] if c.strip())
        if joined:
            memory_context = (
                f"\n\n【你此前已经替大家封存过的记忆批注（可自然呼应，但不要生硬背诵）】：\n"
                f"{joined}"
            )

    return (
        f"你是「记录者」，受「{settings.sender_name}」所托，在生日这天守护这片记忆星空的专属时光记录者。\n"
        "你的性格：温和、敏锐、克制、有观察力，像一位懂摄影的老友兼日记本。\n"
        "你的职责：\n"
        "1. 每次收到新照片时，先捕捉一个具体的画面细节（光影、颜色、构图、人物神态或小物件），"
        "再给出一句温柔的共情，最后抛出一两个轻巧、低门槛的问题引导对方聊起当时的故事。\n"
        "2. 不要说教，不要用客服腔，不要堆砌华丽辞藻，每次回复控制在 60~140 字之间，留出呼吸感。\n"
        f"3. 始终使用温暖自然的中文和「{speaker_name}」对话。"
        f"{memory_context}"
    )


async def _call_vision_chat(
    image_path: Path,
    system_prompt: str,
    history: List[Dict[str, str]],
    user_prompt: str | None = None,
) -> str:
    url = f"{settings.ai_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.ai_api_key}",
        "Content-Type": "application/json",
    }

    data_url = _encode_image_data_url(image_path)
    messages: List[Dict] = [{"role": "system", "content": system_prompt}]

    # Attach the photo on the first user turn so the model always sees the image context.
    first_user_content = [
        {
            "type": "text",
            "text": "请看看我上传的这张照片，作为「记录者」和我聊聊。",
        },
        {
            "type": "image_url",
            "image_url": {"url": data_url},
        },
    ]
    messages.append({"role": "user", "content": first_user_content})

    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})

    if user_prompt:
        messages.append({"role": "user", "content": user_prompt})

    candidate_models = [settings.ai_model]
    is_gemini = "generativelanguage.googleapis.com" in settings.ai_base_url
    if is_gemini:
        for fallback in (
            "gemini-3-flash-preview",
            "gemini-3.1-flash-lite",
            "gemini-3.8-flash",
            "gemini-flash-latest",
        ):
            if fallback not in candidate_models:
                candidate_models.append(fallback)

    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=45.0) as client:
        for attempt in range(2):
            for model_name in candidate_models:
                payload: Dict = {
                    "model": model_name,
                    "messages": messages,
                    "temperature": 0.8,
                    "max_tokens": 1200,
                }
                if is_gemini:
                    payload["reasoning_effort"] = "low"
                try:
                    resp = await client.post(url, headers=headers, json=payload)
                    if resp.status_code in (429, 500, 502, 503, 504):
                        last_exc = httpx.HTTPStatusError(
                            f"HTTP {resp.status_code}", request=resp.request, response=resp
                        )
                        continue
                    resp.raise_for_status()
                    data = resp.json()
                    content = (data["choices"][0]["message"].get("content") or "").strip()
                    if content:
                        return content
                    last_exc = ValueError(f"Empty content from {model_name}")
                except httpx.TimeoutException as exc:
                    last_exc = exc
                    continue
            if attempt == 0:
                await asyncio.sleep(0.8)
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("No AI model succeeded")


async def generate_initial_greeting(
    image_path: Path, recent_captions: List[str]
) -> str:
    """Generate the Chronicler's opening observation when a photo is uploaded."""
    if not settings.ai_enabled:
        return (
            f"「记录者 · 预览模式」我收到这张照片啦。画面里的光线和瞬间都很值得留下来——"
            f"按下快门的那一刻，你当时在想什么，或者身边正发生着什么小事呢？"
            f"（提示：在 backend/.env 填入 AI_API_KEY 后即可开启真实 AI 识图对话）"
        )

    system_prompt = _build_system_prompt(recent_captions)
    try:
        return await _call_vision_chat(image_path, system_prompt, history=[])
    except Exception as exc:
        return f"「记录者暂时走神了」照片我已经妥善收好啦，不过刚才连线出了一点小状况（{exc}）。你也可以先和我说说这张照片的故事。"


async def generate_chat_reply(
    image_path: Path,
    history: List[Dict[str, str]],
    recent_captions: List[str],
) -> str:
    """Continue the conversation about a specific photo."""
    if not settings.ai_enabled:
        return (
            "「记录者 · 预览模式」我记下你说的这一段了。等以后再翻起这张拍立得，"
            "这些细碎的感受会比画面本身更珍贵。如果聊得差不多了，可以点下方「封存这一刻」生成专属批注哦。"
        )

    system_prompt = _build_system_prompt(recent_captions)
    try:
        return await _call_vision_chat(image_path, system_prompt, history=history)
    except Exception as exc:
        return f"抱歉，我刚才记录时笔尖卡了一下（{exc}），你可以再发一次试试。"


async def seal_memory_caption(
    image_path: Path,
    history: List[Dict[str, str]],
    taken_at: str,
) -> str:
    """Distill the photo and chat history into a concise Polaroid caption."""
    if not settings.ai_enabled:
        user_notes = [m["content"] for m in history if m["role"] == "user"]
        snippet = user_notes[-1][:32] if user_notes else "把今天的光影，折叠进这一张拍立得里"
        return f"{snippet}。"

    system_prompt = (
        "你是「记录者」。请结合这张照片的画面与刚才的对话，"
        "写一段适合印在拍立得相纸底部的「记忆批注」。\n"
        "要求：\n"
        "1. 40~80 个汉字以内，温暖、克制、有画面感，像手账或电影旁白。\n"
        "2. 不要使用标题、引号或多余解释，直接输出这段批注正文。\n"
        f"3. 照片记录时间：{taken_at}。"
    )
    try:
        return await _call_vision_chat(
            image_path,
            system_prompt,
            history=history,
            user_prompt="请把我们刚才聊的这些，浓缩成这段照片的拍立得批注吧。",
        )
    except Exception:
        return "把这一刻的光影与心事，安静地封存在这里。"
