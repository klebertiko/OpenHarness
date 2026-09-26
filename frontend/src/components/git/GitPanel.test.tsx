import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { reposApi, RepoApiError, type PullSummary } from "@/lib/reposApi";
import { GitPanel } from "./GitPanel";

vi.mock("@/lib/reposApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reposApi")>();
  return {
    ...actual,
    defaultRepoProvider: () => "fake",
    reposApi: {
      listPulls: vi.fn(),
      createPull: vi.fn(),
      comment: vi.fn(),
      diff: vi.fn(),
      prWatch: vi.fn(),
      getPull: vi.fn(),
      listComments: vi.fn(),
      listReviews: vi.fn(),
      listChecks: vi.fn(),
      listCommits: vi.fn(),
    },
  };
});

const pull1: PullSummary = {
  number: 1,
  title: "feat: add thing",
  state: "open",
  head: "feat/thing",
  base: "main",
  url: "https://example.test/pull/1",
  body: "- [x] done\n- [ ] todo",
  author: "klebertiko",
  authorAvatarUrl: "",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-05T00:00:00Z",
  draft: false,
  merged: false,
  mergeable: true,
  headSha: "abc1234",
};

describe("GitPanel", () => {
  beforeEach(() => {
    vi.mocked(reposApi.listPulls).mockResolvedValue({
      provider: "fake",
      repo: "acme/app",
      pulls: [pull1],
    });
    vi.mocked(reposApi.getPull).mockResolvedValue({ provider: "fake", pull: pull1 });
    vi.mocked(reposApi.diff).mockResolvedValue({ diff: { additions: 10, deletions: 2, changedFiles: 3 } });
    vi.mocked(reposApi.listChecks).mockResolvedValue({ provider: "fake", number: 1, checks: [] });
    vi.mocked(reposApi.listReviews).mockResolvedValue({ provider: "fake", number: 1, reviews: [] });
    vi.mocked(reposApi.listCommits).mockResolvedValue({ provider: "fake", number: 1, commits: [] });
    vi.mocked(reposApi.listComments).mockResolvedValue({ provider: "fake", number: 1, comments: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists pulls and shows an honest empty-detail state before any selection", async () => {
    render(<GitPanel />);
    await screen.findByText("feat: add thing");
    expect(screen.getByText("Select a pull request to see its details.")).toBeTruthy();
    expect(reposApi.getPull).not.toHaveBeenCalled();
  });

  it("shows an honest empty-list message when the repo has no open pulls", async () => {
    vi.mocked(reposApi.listPulls).mockResolvedValue({ provider: "fake", repo: "acme/app", pulls: [] });
    render(<GitPanel />);
    await screen.findByText("No open pulls.");
  });

  it("selecting a pull drives a real detail fetch across all six endpoints", async () => {
    const user = userEvent.setup();
    render(<GitPanel />);
    const row = await screen.findByText("feat: add thing");
    await user.click(row);

    await waitFor(() => expect(reposApi.getPull).toHaveBeenCalledWith("fake", 1, "acme/app"));
    expect(reposApi.diff).toHaveBeenCalledWith("fake", 1, "acme/app");
    expect(reposApi.listChecks).toHaveBeenCalledWith("fake", 1, "acme/app");
    expect(reposApi.listReviews).toHaveBeenCalledWith("fake", 1, "acme/app");
    expect(reposApi.listCommits).toHaveBeenCalledWith("fake", 1, "acme/app");
    expect(reposApi.listComments).toHaveBeenCalledWith("fake", 1, "acme/app");

    await screen.findByText("No conflicts");
    expect(screen.getByText(/\+10/)).toBeTruthy();
    expect(screen.getByText(/-2/)).toBeTruthy();
  });

  it("posting a comment appends it to the visible activity list instead of vanishing", async () => {
    const user = userEvent.setup();
    vi.mocked(reposApi.comment).mockResolvedValue({ ok: true });
    render(<GitPanel />);
    const row = await screen.findByText("feat: add thing");
    await user.click(row);
    await waitFor(() => expect(reposApi.getPull).toHaveBeenCalled());

    vi.mocked(reposApi.listComments).mockResolvedValue({
      provider: "fake",
      number: 1,
      comments: [
        { id: 1, author: "you", authorAvatarUrl: "", body: "nice work", createdAt: "2026-09-06T00:00:00Z" },
      ],
    });

    const textarea = screen.getByLabelText(/comment on pull request #1/i);
    await user.type(textarea, "nice work");
    await user.click(screen.getByRole("button", { name: /post comment/i }));

    await waitFor(() =>
      expect(reposApi.comment).toHaveBeenCalledWith("fake", 1, "acme/app", "nice work")
    );
    await screen.findByText("nice work");
  });

  it("shows an honest 'not supported' message for a section the provider rejects without blanking the rest", async () => {
    const user = userEvent.setup();
    vi.mocked(reposApi.listChecks).mockRejectedValue(
      new RepoApiError("origin has no PR concept", { code: "origin_unsupported_platform", status: 501 })
    );
    render(<GitPanel />);
    const row = await screen.findByText("feat: add thing");
    await user.click(row);

    const notices = await screen.findAllByText("Not supported for this provider.");
    expect(notices.length).toBeGreaterThan(0);
    // The sections that did load are still rendered, not wiped out.
    await screen.findByText("No conflicts");
    expect(screen.getByText(/\+10/)).toBeTruthy();
  });

  it("renders an inert checklist from the PR body without a markdown library", async () => {
    const user = userEvent.setup();
    render(<GitPanel />);
    const row = await screen.findByText("feat: add thing");
    await user.click(row);

    const done = await screen.findByLabelText("done");
    const todo = await screen.findByLabelText("todo");
    expect((done as HTMLInputElement).checked).toBe(true);
    expect((done as HTMLInputElement).disabled).toBe(true);
    expect((todo as HTMLInputElement).checked).toBe(false);
  });
});
