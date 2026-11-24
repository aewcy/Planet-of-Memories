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


def _build_system_prompt(
    recent_captions: List[str],
    speaker_name: str = "朋友",
    user_memory: str = "",
    turn_count: int = 0,
    recent_chat_snippets: List[str] | None = None,
    met_at: str = "",
    is_sun: bool = False,
    in_orbit: bool = True,
    is_initial: bool = False,
) -> str:
    if turn_count < 4:
        familiarity_hint = "你们刚认识不久，保持安静温和的分寸感，先认真看画面、听对方说，不要强行套近乎。"
    elif turn_count < 15:
        familiarity_hint = "你们已经聊过几回了，彼此开始熟悉，说话可以更自然松弛，像平时熟络的朋友在翻相册。"
    else:
        familiarity_hint = "你们已经是很熟的老朋友了，了解对方的性子和习惯，不用客套寒暄，三言两语就能接住对方的心事。"

    sections: List[str] = [
        f"你是「记录者」，受「{settings.sender_name}」所托，守在这片星空里陪「{speaker_name}」聊天。",
        "你的性格：安静温和的老朋友，像平时微信上聊两句，不端着、不说教、不写小作文。",
        f"熟络度：{familiarity_hint}",
        "说话规则（务必严格遵守）：",
        "1. 字数控制：平时闲聊**严格控制在 15~50 个汉字以内**（1~2 句大白话），像真人发微信一样简短；只有当对方明确向你提问、请教或要求展开解释时，才可以写长段回答。",
        "2. 去掉“AI味/点评腔”：严禁使用“透着股真实的生活气息”“反而是最真实的”“时光的温柔”这类总结感叹句，也不要像写作文一样把画面从头描述一遍。",
        "3. 不要乱猜身份：不确定照片里是不是对方本人时，用“照片里”“他/她”或直接聊画面本身。",
        (
            "4. 这是刚上传的照片：挑画面里一个有意思的小细节随口聊一句，最多顺带问一句，别查户口。"
            if is_initial
            else "4. 这是日常接话：顺着对方的话自然接一两句就行，不需要每条都反问。"
        ),
        "5. 始终用自然平实的中文。",
    ]

    scene_notes: List[str] = []
    if is_sun:
        origin = f"（记录的起点日期：{met_at}）" if met_at else ""
        scene_notes.append(f"这张照片是当前星系的中心主星{origin}，对这里有特别的意义，语气可以更沉静珍重一些。")
    else:
        if met_at:
            scene_notes.append(f"这片星系的主星起点日期是 {met_at}。")
        if not in_orbit:
            scene_notes.append("这颗星星没有放进星系轨道里旋转，而是选择在外环深空安静漂流。")
    if scene_notes:
        sections.append("【当前星空语境】\n" + "\n".join(scene_notes))

    if user_memory.strip():
        sections.append(
            f"【你慢慢记住的关于「{speaker_name}」的印象（习惯、喜好、近况与想法）】\n"
            f"{user_memory.strip()}\n"
            "（注意：把这些印象自然融进你的分寸与共情里，绝对不要生硬地说“根据我的记录”或“我记得你以前说过”。）"
        )

    if recent_chat_snippets:
        joined_chats = "\n".join(f"- {s}" for s in recent_chat_snippets[:4] if s.strip())
        if joined_chats:
            sections.append(f"【最近在其他照片里聊过的话题片段】\n{joined_chats}")

    if recent_captions:
        joined = "\n".join(f"- {c}" for c in recent_captions[:4] if c.strip())
        if joined:
            sections.append(f"【此前已封存的拍立得批注】\n{joined}")

    return "\n\n".join(sections)


async def _post_chat_completions(
    messages: List[Dict],
    temperature: float = 0.8,
    max_tokens: int = 1200,
) -> str:
    url = f"{settings.ai_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.ai_api_key}",
        "Content-Type": "application/json",
    }

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
                    "temperature": temperature,
                    "max_tokens": max_tokens,
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


async def _call_vision_chat(
    image_path: Path,
    system_prompt: str,
    history: List[Dict[str, str]],
    user_prompt: str | None = None,
) -> str:
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

    return await _post_chat_completions(messages)


async def generate_initial_greeting(
    image_path: Path,
    recent_captions: List[str],
    speaker_name: str = "朋友",
    user_memory: str = "",
    turn_count: int = 0,
    recent_chat_snippets: List[str] | None = None,
    met_at: str = "",
    is_sun: bool = False,
    in_orbit: bool = True,
) -> str:
    """Generate the Chronicler's opening observation when a photo is uploaded."""
    if not settings.ai_enabled:
        return (
            f"「记录者 · 预览模式」我收到这张照片啦，{speaker_name}。画面里的光线和瞬间都很值得留下来——"
            f"按下快门那会儿，身边正发生着什么小事呀？"
            f"（提示：在 backend/.env 填入 AI_API_KEY 后即可开启真实 AI 识图对话）"
        )

    system_prompt = _build_system_prompt(
        recent_captions=recent_captions,
        speaker_name=speaker_name,
        user_memory=user_memory,
        turn_count=turn_count,
        recent_chat_snippets=recent_chat_snippets,
        met_at=met_at,
        is_sun=is_sun,
        in_orbit=in_orbit,
        is_initial=True,
    )
    try:
        return await _call_vision_chat(image_path, system_prompt, history=[])
    except Exception as exc:
        return f"「记录者暂时走神了」照片我已经妥善收好啦，不过刚才连线出了一点小状况（{exc}）。你也可以先和我说说这张照片的故事。"


async def generate_chat_reply(
    image_path: Path,
    history: List[Dict[str, str]],
    recent_captions: List[str],
    speaker_name: str = "朋友",
    user_memory: str = "",
    turn_count: int = 0,
    recent_chat_snippets: List[str] | None = None,
    met_at: str = "",
    is_sun: bool = False,
    in_orbit: bool = True,
) -> str:
    """Continue the conversation about a specific photo."""
    if not settings.ai_enabled:
        return (
            "「记录者 · 预览模式」我记下你说的这一段了。等以后再翻起这张拍立得，"
            "这些细碎的感受会比画面本身更珍贵。如果聊得差不多了，可以点下方「封存这一刻」生成专属批注哦。"
        )

    system_prompt = _build_system_prompt(
        recent_captions=recent_captions,
        speaker_name=speaker_name,
        user_memory=user_memory,
        turn_count=turn_count,
        recent_chat_snippets=recent_chat_snippets,
        met_at=met_at,
        is_sun=is_sun,
        in_orbit=in_orbit,
        is_initial=False,
    )
    try:
        return await _call_vision_chat(image_path, system_prompt, history=history)
    except Exception as exc:
        return f"抱歉，我刚才记录时笔尖卡了一下（{exc}），你可以再发一次试试。"


async def summarize_user_memory(
    speaker_name: str,
    current_memory: str,
    recent_exchange: str,
) -> str:
    """Quietly merge newly observed habits, preferences, and thoughts into a concise memory note."""
    if not settings.ai_enabled or not recent_exchange.strip():
        return current_memory

    system_prompt = (
        f"你是「记录者」的私人备忘本，专门悄悄记下关于「{speaker_name}」的长期印象。\n"
        "请结合【已有印象】和【刚才的新对话】，合并更新一份简练、真实、不肉麻的个人印象笔记。\n"
        "只记录真正有长期价值的信息：生活习惯、作息、喜好厌恶、拍照偏好、最近在忙的事、想法性格、说话口癖。\n"
        "要求：\n"
        "1. 用简短分点或自然短句，总字数严格控制在 240 字以内。\n"
        "2. 保留依然成立的旧印象，合并或更新变化的内容，不要记录无意义的客套话。\n"
        "3. 直接输出更新后的印象正文，不要加任何标题或解释。"
    )
    user_prompt = (
        f"【已有印象】\n{current_memory.strip() or '（暂无，这是刚开始认识）'}\n\n"
        f"【刚才的新对话】\n{recent_exchange.strip()}"
    )
    try:
        updated = await _post_chat_completions(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=600,
        )
        return updated[:320] if updated else current_memory
    except Exception:
        return current_memory


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
        "1. 25~65 个汉字以内，平实、温暖、有画面感，像老友在相纸背面留下的短句，不要堆砌华丽辞藻。\n"
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
