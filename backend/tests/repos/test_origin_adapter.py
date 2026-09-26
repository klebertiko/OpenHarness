"""Origin adapter — native Windows returns code=origin_unsupported_platform."""

from __future__ import annotations

import asyncio

import pytest

from repos.base import RepoError
from repos.origin import OriginRepoProvider


def test_native_windows_raises_origin_unsupported_platform() -> None:
    async def exercise() -> None:
        provider = OriginRepoProvider(
            platform_fn=lambda: "win32",
            is_wsl_fn=lambda: False,
            which_fn=lambda _: "/usr/bin/origin",
        )
        with pytest.raises(RepoError) as exc:
            await provider.list_pulls("acme/app")
        assert exc.value.code == "origin_unsupported_platform"
        assert "Windows" in exc.value.message

        with pytest.raises(RepoError) as exc2:
            await provider.create_pull("acme/app", "t", "h", "main", "b")
        assert exc2.value.code == "origin_unsupported_platform"

        with pytest.raises(RepoError) as exc3:
            await provider.comment("acme/app", 1, "x")
        assert exc3.value.code == "origin_unsupported_platform"

        with pytest.raises(RepoError) as exc4:
            await provider.get_diff_stat("acme/app", 1)
        assert exc4.value.code == "origin_unsupported_platform"

        for op in (
            provider.get_pull,
            provider.list_comments,
            provider.list_reviews,
            provider.list_checks,
            provider.list_commits,
        ):
            with pytest.raises(RepoError) as exc5:
                await op("acme/app", 1)
            assert exc5.value.code == "origin_unsupported_platform"

        payload = exc.value.to_dict()
        assert payload == {
            "code": "origin_unsupported_platform",
            "message": exc.value.message,
        }

    asyncio.run(exercise())


def test_wsl_or_unix_missing_cli_raises_clear_error() -> None:
    async def exercise() -> None:
        provider = OriginRepoProvider(
            platform_fn=lambda: "linux",
            is_wsl_fn=lambda: False,
            which_fn=lambda _: None,
        )
        with pytest.raises(RepoError) as exc:
            await provider.list_pulls("acme/app")
        assert exc.value.code == "origin_cli_missing"

    asyncio.run(exercise())


def test_unix_with_cli_stub_not_implemented() -> None:
    async def exercise() -> None:
        provider = OriginRepoProvider(
            platform_fn=lambda: "darwin",
            is_wsl_fn=lambda: False,
            which_fn=lambda _: "/usr/local/bin/origin",
        )
        with pytest.raises(RepoError) as exc:
            await provider.list_pulls("acme/app")
        assert exc.value.code == "origin_not_implemented"

    asyncio.run(exercise())
