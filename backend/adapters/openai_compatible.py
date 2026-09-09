"""Covers: OpenAI API, Ollama (localhost:11434/v1), LM Studio, any OpenAI-compatible runtime."""
from typing import AsyncIterator
import httpx
from .base import AgentAdapter, AdapterConfig, AdapterResult

DEFAULT_ENDPOINTS = {
    "ollama": "http://host.docker.internal:11434/v1",
    "openai": "https://api.openai.com/v1",
    "lmstudio": "http://host.docker.internal:1234/v1",
}


class OpenAICompatibleAdapter(AgentAdapter):
    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        endpoint = config.endpoint or DEFAULT_ENDPOINTS.get(config.adapter, "https://api.openai.com/v1")
        messages = []
        if config.system_prompt:
            messages.append({"role": "system", "content": config.system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "stream": False,
        }
        headers = {"Content-Type": "application/json"}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{endpoint}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            choice = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            return AdapterResult(
                content=choice,
                tokens_used=usage.get("total_tokens", 0),
                model=data.get("model", config.model),
            )

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        endpoint = config.endpoint or DEFAULT_ENDPOINTS.get(config.adapter, "https://api.openai.com/v1")
        messages = []
        if config.system_prompt:
            messages.append({"role": "system", "content": config.system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "stream": True,
        }
        headers = {"Content-Type": "application/json"}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"

        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream("POST", f"{endpoint}/chat/completions", json=payload, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        chunk = line[6:]
                        if chunk == "[DONE]":
                            break
                        import json
                        try:
                            data = json.loads(chunk)
                            delta = data["choices"][0]["delta"].get("content", "")
                            if delta:
                                yield delta
                        except (json.JSONDecodeError, KeyError, IndexError):
                            pass
