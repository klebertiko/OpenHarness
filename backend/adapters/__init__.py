from .base import AgentAdapter, AdapterConfig, AdapterResult
from .openai_compatible import OpenAICompatibleAdapter
from .claude import ClaudeAdapter
from .mock import MockAdapter


def get_adapter(adapter_name: str) -> AgentAdapter:
    adapters = {
        "ollama": OpenAICompatibleAdapter(),
        "openai": OpenAICompatibleAdapter(),
        "lmstudio": OpenAICompatibleAdapter(),
        "codex": OpenAICompatibleAdapter(),
        "claude": ClaudeAdapter(),
        "mock": MockAdapter(),
    }
    return adapters.get(adapter_name, MockAdapter())
