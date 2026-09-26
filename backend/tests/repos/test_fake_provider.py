"""FakeRepoProvider covers the full RepoProvider surface."""

from __future__ import annotations

import asyncio

import pytest

from repos.base import CheckRun, Comment, Commit, DiffStat, PullSummary, RepoError, RepoProvider, Review
from repos.fake import FakeRepoProvider


def test_fake_implements_repo_provider_protocol() -> None:
    provider = FakeRepoProvider()
    assert isinstance(provider, RepoProvider)


def test_list_create_comment_diff_stat() -> None:
    async def exercise() -> None:
        fake = FakeRepoProvider()
        fake.seed_pull(
            "acme/app",
            PullSummary(
                number=1,
                title="Seeded",
                state="open",
                head="feature",
                base="main",
                url="fake://acme/app/pull/1",
            ),
            diff=DiffStat(additions=10, deletions=2, changed_files=3),
        )

        open_pulls = await fake.list_pulls("acme/app", state="open")
        assert len(open_pulls) == 1
        assert open_pulls[0].title == "Seeded"

        created = await fake.create_pull(
            "acme/app",
            title="New PR",
            head="feat/x",
            base="main",
            body="hello",
        )
        assert created.number == 2
        assert created.state == "open"
        assert created.body == "hello"

        all_pulls = await fake.list_pulls("acme/app", state="all")
        assert {p.number for p in all_pulls} == {1, 2}

        await fake.comment("acme/app", 2, "LGTM")
        assert fake.comments_for("acme/app", 2) == ["LGTM"]

        stat = await fake.get_diff_stat("acme/app", 1)
        assert stat == DiffStat(additions=10, deletions=2, changed_files=3)

        fresh = await fake.get_diff_stat("acme/app", 2)
        assert fresh.changed_files == 0

    asyncio.run(exercise())


def test_comment_missing_pull_raises() -> None:
    async def exercise() -> None:
        fake = FakeRepoProvider()
        with pytest.raises(RepoError) as exc:
            await fake.comment("acme/app", 99, "nope")
        assert exc.value.code == "pull_not_found"

    asyncio.run(exercise())


def test_create_pull_seeds_honest_defaults() -> None:
    """A freshly created PR gets a real head commit + an in-flight check —
    never a fabricated pass/fail or a fake reviewer."""

    async def exercise() -> None:
        fake = FakeRepoProvider()
        created = await fake.create_pull(
            "acme/app", title="New PR", head="feat/x", base="main", body="hello"
        )
        assert created.author == "you"
        assert created.draft is False
        assert created.merged is False
        assert created.mergeable is True
        assert created.head_sha

        commits = await fake.list_commits("acme/app", created.number)
        assert len(commits) == 1
        assert commits[0].sha == created.head_sha

        checks = await fake.list_checks("acme/app", created.number)
        assert len(checks) == 1
        assert checks[0].status == "in_progress"
        assert checks[0].conclusion == ""

        # Nobody has reviewed or commented on a brand-new PR yet.
        assert await fake.list_reviews("acme/app", created.number) == []
        assert await fake.list_comments("acme/app", created.number) == []

    asyncio.run(exercise())


def test_get_pull_and_list_comments_reflect_seeded_detail() -> None:
    async def exercise() -> None:
        fake = FakeRepoProvider()
        fake.seed_pull(
            "acme/app",
            PullSummary(
                number=9,
                title="Seeded detail",
                state="open",
                head="feat/detail",
                base="main",
                author="klebertiko",
                author_avatar_url="https://example.com/a.png",
                created_at="2026-09-01T00:00:00Z",
                draft=True,
                mergeable=None,
            ),
            comments=[
                Comment(
                    id=1,
                    author="bot",
                    author_avatar_url="",
                    body="CI started",
                    created_at="2026-09-01T00:05:00Z",
                )
            ],
            reviews=[
                Review(
                    id=1,
                    author="reviewer1",
                    author_avatar_url="",
                    state="approved",
                    submitted_at="2026-09-02T00:00:00Z",
                )
            ],
            checks=[CheckRun(name="lint", status="completed", conclusion="success")],
            commits=[
                Commit(sha="abc123", message="init", author="klebertiko", authored_at="2026-09-01T00:00:00Z")
            ],
        )

        pull = await fake.get_pull("acme/app", 9)
        assert pull.author == "klebertiko"
        assert pull.draft is True
        assert pull.mergeable is None

        comments = await fake.list_comments("acme/app", 9)
        assert comments[0].body == "CI started"

        reviews = await fake.list_reviews("acme/app", 9)
        assert reviews[0].state == "approved"

        checks = await fake.list_checks("acme/app", 9)
        assert checks[0].conclusion == "success"

        commits = await fake.list_commits("acme/app", 9)
        assert commits[0].sha == "abc123"

    asyncio.run(exercise())


def test_detail_methods_raise_on_missing_pull() -> None:
    async def exercise() -> None:
        fake = FakeRepoProvider()
        for op in (
            fake.get_pull,
            fake.list_comments,
            fake.list_reviews,
            fake.list_checks,
            fake.list_commits,
        ):
            with pytest.raises(RepoError) as exc:
                await op("acme/app", 404)
            assert exc.value.code == "pull_not_found"

    asyncio.run(exercise())
