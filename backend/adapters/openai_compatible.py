"""Covers: OpenAI API, Ollama (localhost:11434/v1), LM Studio, any OpenAI-compatible runtime."""
import time
import json
from typing import AsyncIterator
import httpx
from .base import AgentAdapter, AdapterConfig, AdapterResult, ProbeResult

DEFAULT_ENDPOINTS = {
    "ollama": "http://host.docker.internal:11434/v1",
    "openai": "https://api.openai.com/v1",
    "lmstudio": "http://host.docker.internal:1234/v1",
}


class OpenAICompatibleAdapter(AgentAdapter):
    def __init__(self, *, transport: httpx.BaseTransport | None = None) -> None:
        # Injectable so tests can assert on real request/response handling
        # without hitting the network (see tests/test_openai_compatible.py) —
        # None (the default) is ordinary httpx behavior, a real connection.
        self._transport = transport

    async def stream_turn(self, messages: list[dict], config: AdapterConfig, tools: list[dict] | None = None) -> AsyncIterator[dict]:
        """One HTTP turn; assemble streamed function arguments before exposing calls."""
        endpoint = config.endpoint or DEFAULT_ENDPOINTS.get(config.adapter, 'https://api.openai.com/v1')
        payload = {'model': config.model, 'messages': messages, 'temperature': config.temperature,
                   'max_tokens': config.max_tokens, 'stream': True, 'stream_options': {'include_usage': True}}
        if tools:
            payload.update(tools=tools, tool_choice='auto')
        headers = {'Authorization': f'Bearer {config.api_key}'} if config.api_key else {}
        calls = {}
        async with httpx.AsyncClient(timeout=120, transport=self._transport) as client:
            async with client.stream('POST', f'{endpoint}/chat/completions', json=payload, headers=headers) as response:
                if response.status_code >= 400:
                    await response.aread()
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith('data: '):
                        continue
                    if line[6:] == '[DONE]':
                        break
                    try:
                        data = json.loads(line[6:])
                    except ValueError:
                        continue
                    usage = data.get('usage') or {}
                    if 'total_tokens' in usage:
                        yield {'kind': 'usage', 'tokens': usage['total_tokens']}
                    choices = data.get('choices') or []
                    if not choices:
                        continue
                    delta = choices[0].get('delta') or {}
                    if delta.get('content'):
                        yield {'kind': 'text', 'text': delta['content']}
                    for fragment in delta.get('tool_calls') or []:
                        index = fragment.get('index', 0)
                        if not isinstance(index, int) or index < 0 or index >= 64:
                            raise ValueError('Provider tool call limit exceeded')
                        call = calls.setdefault(index, {'id': '', 'type': 'function', 'function': {'name': '', 'arguments': ''}})
                        if fragment.get('id'):
                            call['id'] += fragment['id']
                        function = fragment.get('function') or {}
                        for key in ('name', 'arguments'):
                            call['function'][key] += function.get(key) or ''
                        if sum(len(str(value)) for value in call.values()) > 262144:
                            raise ValueError('Provider tool arguments too large')
        if calls:
            yield {'kind': 'tool_calls', 'calls': [calls[index] for index in sorted(calls)]}

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        """`GET /models` — every OpenAI-compatible surface serves it, it costs
        no tokens, and a bad or missing key still 401s there same as it would
        on a real completion, so this checks reachability and the credential
        in one request."""
        endpoint = config.endpoint or DEFAULT_ENDPOINTS.get(config.adapter, "https://api.openai.com/v1")
        headers = {}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"

        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
                resp = await client.get(f"{endpoint}/models", headers=headers)
        except httpx.ConnectError:
            return ProbeResult(ok=False, health="fault", detail=f"Could not reach {endpoint}.")
        except httpx.TimeoutException:
            return ProbeResult(ok=False, health="fault", detail=f"{endpoint} did not respond in time.")
        except httpx.HTTPError as exc:
            return ProbeResult(ok=False, health="fault", detail=str(exc))
        latency_ms = int((time.monotonic() - started) * 1000)

        if resp.status_code == 401:
            return ProbeResult(
                ok=False, health="fault", latency_ms=latency_ms,
                detail="401 unauthorized — the key was rejected or has been revoked.",
            )
        if resp.status_code >= 400:
            return ProbeResult(
                ok=False, health="fault", latency_ms=latency_ms,
                detail=f"HTTP {resp.status_code} from {endpoint}.",
            )

        count = None
        try:
            count = len(resp.json().get("data", []))
        except (ValueError, AttributeError):
            pass
        detail = f"{count} models available." if count is not None else "Reachable."
        return ProbeResult(ok=True, health="live", latency_ms=latency_ms, detail=detail)


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

        async with httpx.AsyncClient(timeout=120, transport=self._transport) as client:
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

        async with httpx.AsyncClient(timeout=120, transport=self._transport) as client:
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
