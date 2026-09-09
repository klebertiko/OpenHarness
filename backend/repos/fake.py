"""In-memory FakeRepoProvider for tests and REPO_PROVIDER=fake."""

from __future__ import annotations

from repos.base import DiffStat, PullSummary, RepoError


class FakeRepoProvider:
    """Mutable in-memory adapter implementing ``RepoProvider``."""

    def __init__(self) -> None:
        self._pulls: dict[str, list[PullSummary]] = {}
        self._comments: dict[tuple[str, int], list[str]] = {}
        self._diff_stats: dict[tuple[str, int], DiffStat] = {}
        self._next_number: dict[str, int] = {}

    def seed_pull(self, repo: str, pull: PullSummary, *, diff: DiffStat | None = None) -> None:
        self._pulls.setdefault(repo, []).append(pull)
        self._next_number[repo] = max(self._next_number.get(repo, 0), pull.number + 1)
        if diff is not None:
            self._diff_stats[(repo, pull.number)] = diff

    async def list_pulls(self, repo: str, state: str = "open") -> list[PullSummary]:
        pulls = self._pulls.get(repo, [])
        if state == "all":
            return list(pulls)
        return [p for p in pulls if p.state == state]

    async def create_pull(
        self,
        repo: str,
        title: str,
        head: str,
        base: str,
        body: str,
    ) -> PullSummary:
        number = self._next_number.get(repo, 1)
        self._next_number[repo] = number + 1
        pull = PullSummary(
            number=number,
            title=title,
            state="open",
            head=head,
            base=base,
            url=f"fake://{repo}/pull/{number}",
            body=body,
        )
        self._pulls.setdefault(repo, []).append(pull)
        self._diff_stats[(repo, number)] = DiffStat(additions=0, deletions=0, changed_files=0)
        return pull

    async def comment(self, repo: str, number: int, body: str) -> None:
        if not any(p.number == number for p in self._pulls.get(repo, [])):
            raise RepoError("pull_not_found", f"No pull #{number} in {repo}")
        self._comments.setdefault((repo, number), []).append(body)

    async def get_diff_stat(self, repo: str, number: int) -> DiffStat:
        key = (repo, number)
        if key not in self._diff_stats:
            raise RepoError("pull_not_found", f"No pull #{number} in {repo}")
        return self._diff_stats[key]

    def comments_for(self, repo: str, number: int) -> list[str]:
        return list(self._comments.get((repo, number), []))
