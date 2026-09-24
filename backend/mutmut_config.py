"""Never mutate application sources in the shared checkout."""
from pathlib import Path


def pre_mutation(context):
    if not (Path(__file__).resolve().parent.parent / '.git').is_file():
        raise RuntimeError('Mutation testing requires an isolated git worktree; shared checkout refused.')
