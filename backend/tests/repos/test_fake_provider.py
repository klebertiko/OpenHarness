"""FakeRepoProvider covers the full RepoProvider surface."""

from __future__ import annotations

import asyncio

import pytest

from repos.base import DiffStat, PullSummary, RepoError, RepoProvider
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
