from pathlib import Path

LIMITS = {'read_max_bytes': 262144, 'exec_timeout_s': 60, 'exec_max_timeout_s': 600,
          'exec_output_max_bytes': 65536, 'max_tool_calls_per_turn': 8, 'max_reads_per_turn': 20}


def capabilities(root: str | None, adapter: str, *, name: str | None = None, unsupported: bool = False) -> dict:
    kind = 'mock' if adapter == 'mock' else 'cli' if adapter in {'claude', 'codex', 'cursor'} else 'http'
    reason = ('no-workspace' if root is None else 'mock' if kind == 'mock' else
              'cli-adapter' if kind == 'cli' else 'provider-no-tools' if unsupported else 'ok')
    enabled = reason == 'ok'
    return {'workspace': {'root': root, 'name': name or Path(root).name} if root else None,
            'provider_kind': kind, 'reason': reason,
            'tools': {'discover': root is not None, 'read': enabled, 'exec': enabled},
            'preset': {'read': root is not None, 'exec': root is not None and kind != 'mock'},
            'limits': dict(LIMITS)}
