"""Claude adapter — uses Anthropic SDK directly."""
from typing import AsyncIterator
import anthropic
from .base import AgentAdapter, AdapterConfig, AdapterResult


class ClaudeAdapter(AgentAdapter):
    def _client(self, config: AdapterConfig) -> anthropic.AsyncAnthropic:
        return anthropic.AsyncAnthropic(api_key=config.api_key or None)

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        client = self._client(config)
        kwargs: dict = {
            "model": config.model or "claude-opus-4-8",
            "max_tokens": config.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if config.system_prompt:
            kwargs["system"] = config.system_prompt

        msg = await client.messages.create(**kwargs)
        content = msg.content[0].text if msg.content else ""
        usage = msg.usage
        return AdapterResult(
            content=content,
            tokens_used=(usage.input_tokens + usage.output_tokens) if usage else 0,
            model=msg.model,
        )

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        client = self._client(config)
        kwargs: dict = {
            "model": config.model or "claude-opus-4-8",
            "max_tokens": config.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if config.system_prompt:
            kwargs["system"] = config.system_prompt

        async with client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text
