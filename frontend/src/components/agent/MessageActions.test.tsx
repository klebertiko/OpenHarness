import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessageActions } from "./MessageActions";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("copies the exact text and only confirms after the clipboard accepts it", async () => {
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<MessageActions content="<script>not HTML</script>" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Copied"));
  expect(copy).toHaveBeenCalledWith("<script>not HTML</script>");
});
it("shows a manual recovery when clipboard access fails and reuse only fills a draft", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
  const reuse = vi.fn();
  render(<MessageActions content="hello" onReuse={reuse} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("manually"));
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reuse message" }));
  expect(reuse).toHaveBeenCalledOnce();
});
