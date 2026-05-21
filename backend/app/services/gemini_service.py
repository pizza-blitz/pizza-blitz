import json
import os
from typing import Any

from fastapi import HTTPException


def _api_key(missing_key_detail: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail=missing_key_detail)
    return api_key


def _client(missing_key_detail: str):
    try:
        from google import genai
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="google-genai package is not installed. Install backend requirements.",
        ) from exc

    return genai.Client(api_key=_api_key(missing_key_detail))


def bytes_part(data: bytes, mime_type: str):
    try:
        from google.genai import types
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="google-genai package is not installed. Install backend requirements.",
        ) from exc

    return types.Part.from_bytes(data=data, mime_type=mime_type)


def generate_text(
    *,
    model: str,
    contents: Any,
    missing_key_detail: str = "Gemini API Key not configured",
) -> str:
    response = _client(missing_key_detail).models.generate_content(
        model=model,
        contents=contents,
    )
    return (response.text or "").strip()


def parse_json_response(text: str) -> Any:
    cleaned = text.replace("```json", "").replace("```", "").strip()
    return json.loads(cleaned)
