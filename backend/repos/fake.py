"""In-memory FakeRepoProvider for tests and REPO_PROVIDER=fake."""

from __future__ import annotations

from itertools import count

from repos.base import CheckRun, Comment, Commit, DiffStat, PullSummary, RepoError, Review


class FakeRepoProvider:
    """Mutable in-memory adapter implementing ``RepoProvider``.

    Every field the UI can render has a real, populated value once a pull is
    created or explicitly seeded — nothing is a placeholder pretending to be
    live data.
    """

    def __init__(self) -> None:
        self._pulls: dict[str, list[PullSummary]] = {}
        self._comments: dict[tuple[str, int], list[Comment]] = {}
        self._reviews: dict[tuple[str, int], list[Review]] = {}
        self._checks: dict[tuple[str, int], list[CheckRun]] = {}
        self._commits: dict[tuple[str, int], list[Commit]] = {}
        self._diff_stats: dict[tuple[str, int], DiffStat] = {}
        self._next_number: dict[str, int] = {}
        self._comment_ids = count(1)

    def seed_pull(
        self,
        repo: str,
        pull: PullSummary,
        *,
        diff: DiffStat | None = None,
        comments: list[Comment] | None = None,
        reviews: list[Review] | None = None,
        checks: list[CheckRun] | None = None,
        commits: list[Commit] | None = None,
    ) -> None:
        self._pulls.setdefault(repo, []).append(pull)
        self._next_number[repo] = max(self._next_number.get(repo, 0), pull.number + 1)
        if diff is not None:
            self._diff_stats[(repo, pull.number)] = diff
        self._comments[(repo, pull.number)] = list(comments or [])
        self._reviews[(repo, pull.number)] = list(reviews or [])
        self._checks[(repo, pull.number)] = list(checks or [])
        self._commits[(repo, pull.number)] = list(commits or [])

    def _find(self, repo: str, number: int) -> PullSummary:
        for pull in self._pulls.get(repo, []):
            if pull.number == number:
                return pull
        raise RepoError("pull_not_found", f"No pull #{number} in {repo}")

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
        now = "2026-09-11T00:00:00Z"
        head_sha = f"{number:07x}fake"
        pull = PullSummary(
            number=number,
            title=title,
            state="open",
            head=head,
            base=base,
            url=f"fake://{repo}/pull/{number}",
            body=body,
            author="you",
            author_avatar_url="",
            created_at=now,
            updated_at=now,
            draft=False,
            merged=False,
            mergeable=True,
            head_sha=head_sha,
        )
        self._pulls.setdefault(repo, []).append(pull)
        self._diff_stats[(repo, number)] = DiffStat(additions=0, deletions=0, changed_files=0)
        self._comments[(repo, number)] = []
        self._reviews[(repo, number)] = []
        # A freshly opened PR honestly has one commit (the head) and one
        # check that just started — never a fabricated pass/fail.
        self._commits[(repo, number)] = [
            Commit(sha=head_sha, message=title, author="you", authored_at=now)
        ]
        self._checks[(repo, number)] = [
            CheckRun(name="build", status="in_progress", conclusion="")
        ]
        return pull

    async def comment(self, repo: str, number: int, body: str) -> None:
        self._find(repo, number)
        entry = Comment(
            id=next(self._comment_ids),
            author="you",
            author_avatar_url="",
            body=body,
            created_at="2026-09-11T00:00:00Z",
        )
        self._comments.setdefault((repo, number), []).append(entry)

    async def get_diff_stat(self, repo: str, number: int) -> DiffStat:
        key = (repo, number)
        if key not in self._diff_stats:
            raise RepoError("pull_not_found", f"No pull #{number} in {repo}")
        return self._diff_stats[key]

    async def get_pull(self, repo: str, number: int) -> PullSummary:
        return self._find(repo, number)

    async def list_comments(self, repo: str, number: int) -> list[Comment]:
        self._find(repo, number)
        return list(self._comments.get((repo, number), []))

    async def list_reviews(self, repo: str, number: int) -> list[Review]:
        self._find(repo, number)
        return list(self._reviews.get((repo, number), []))

    async def list_checks(self, repo: str, number: int) -> list[CheckRun]:
        self._find(repo, number)
        return list(self._checks.get((repo, number), []))

    async def list_commits(self, repo: str, number: int) -> list[Commit]:
        self._find(repo, number)
        return list(self._commits.get((repo, number), []))

    def comments_for(self, repo: str, number: int) -> list[str]:
        """Back-compat helper: comment bodies only (used by earlier tests)."""
        return [c.body for c in self._comments.get((repo, number), [])]
