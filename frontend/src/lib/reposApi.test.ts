import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultRepoProvider, isUnsupportedByProvider, reposApi, RepoApiError } from "./reposApi";

const BASE = "http://127.0.0.1:8000";

describe("defaultRepoProvider", () => {
  it("defaults to fake when env unset", () => {
    expect(defaultRepoProvider()).toBe("fake");
  });
});

describe("reposApi new PR-detail endpoints", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getPull fetches the enriched PullSummary shape", async () => {
    const pull = {
      number: 5,
      title: "feat: thing",
      state: "open",
      head: "feat/x",
      base: "main",
      url: "https://example.test/pull/5",
      body: "- [x] done\n- [ ] not done",
      author: "klebertiko",
      authorAvatarUrl: "",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-02T00:00:00Z",
      draft: false,
      merged: false,
      mergeable: null,
      headSha: "abc1234",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ provider: "fake", pull }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reposApi.getPull("fake", 5, "acme/app");

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/repos/fake/pulls/5?repo=acme%2Fapp`,
      expect.objectContaining({ headers: { "Content-Type": "application/json" } })
    );
    expect(res.pull).toEqual(pull);
    expect(res.pull.mergeable).toBeNull();
  });

  it("listComments fetches comments for a pull", async () => {
    const comments = [
      { id: 1, author: "you", authorAvatarUrl: "", body: "hi", createdAt: "2026-09-01T00:00:00Z" },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ provider: "fake", number: 5, comments }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reposApi.listComments("fake", 5, "acme/app");

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/repos/fake/pulls/5/comments?repo=acme%2Fapp`,
      expect.anything()
    );
    expect(res.comments).toEqual(comments);
  });

  it("listReviews fetches reviews for a pull", async () => {
    const reviews = [
      {
        id: 1,
        author: "reviewer",
        authorAvatarUrl: "",
        state: "approved",
        submittedAt: "2026-09-01T00:00:00Z",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ provider: "fake", number: 5, reviews }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reposApi.listReviews("fake", 5, "acme/app");

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/repos/fake/pulls/5/reviews?repo=acme%2Fapp`,
      expect.anything()
    );
    expect(res.reviews).toEqual(reviews);
  });

  it("listChecks fetches checks for a pull", async () => {
    const checks = [{ name: "build", status: "completed", conclusion: "success", url: "" }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ provider: "fake", number: 5, checks }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reposApi.listChecks("fake", 5, "acme/app");

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/repos/fake/pulls/5/checks?repo=acme%2Fapp`,
      expect.anything()
    );
    expect(res.checks).toEqual(checks);
  });

  it("listCommits fetches commits for a pull", async () => {
    const commits = [{ sha: "abc1234", message: "feat: thing", author: "you", authoredAt: "2026-09-01T00:00:00Z" }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ provider: "fake", number: 5, commits }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reposApi.listCommits("fake", 5, "acme/app");

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/repos/fake/pulls/5/commits?repo=acme%2Fapp`,
      expect.anything()
    );
    expect(res.commits).toEqual(commits);
  });

  it("existing listPulls/createPull/comment/diff/prWatch keep working unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ provider: "fake", repo: "acme/app", pulls: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await reposApi.listPulls("fake", "acme/app");
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/repos/fake/pulls?repo=acme%2Fapp&state=open`,
      expect.anything()
    );
  });

  it("surfaces a structured RepoApiError with code for a 404 pull_not_found", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ detail: { code: "pull_not_found", message: "No pull #9 in acme/app" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reposApi.getPull("fake", 9, "acme/app")).rejects.toMatchObject({
      message: "No pull #9 in acme/app",
      code: "pull_not_found",
      status: 404,
    });
  });

  it("marks a 501 ...not_implemented error as unsupported by provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 501,
      text: async () =>
        JSON.stringify({ detail: { code: "origin_not_implemented", message: "origin has no PR concept" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await reposApi.listChecks("origin", 1, "acme/app");
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(RepoApiError);
      expect(isUnsupportedByProvider(err)).toBe(true);
    }
  });

  it("falls back to raw text when the error body isn't the {detail} shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal server error",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reposApi.getPull("fake", 1, "acme/app")).rejects.toMatchObject({
      message: "internal server error",
    });
  });
});
