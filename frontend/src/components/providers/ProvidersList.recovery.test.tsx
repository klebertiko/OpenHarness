import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProvidersList } from "./ProvidersList";
import { useUsageStore } from "./usageStore";
import { usageApi } from "@/lib/usageApi";
vi.mock("@/lib/usageApi", () => ({ usageApi: { summary: vi.fn(), setBudget: vi.fn() } }));
const initial = useUsageStore.getState();
beforeEach(() => { vi.clearAllMocks(); useUsageStore.setState({ ...initial, hydrated: true }); });
afterEach(cleanup);
it("keeps a failed budget edit available for correction and retry", async () => {
  vi.mocked(usageApi.setBudget).mockRejectedValue(new Error("sidecar unavailable"));
  render(<ProvidersList />);
  fireEvent.click(screen.getByRole("button", { name: "No budget — set one" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Global budget in USD" }), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("sidecar unavailable"));
  expect((screen.getByRole("textbox", { name: "Global budget in USD" }) as HTMLInputElement).value).toBe("15");
  expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
});
it("refreshes real usage after a previous load failure", async () => {
  useUsageStore.setState({ error: "offline" });
  vi.mocked(usageApi.summary).mockResolvedValue({ byConnection: [], budget: { limitUsd: null, state: "unset" } } as never);
  render(<ProvidersList />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(usageApi.summary).toHaveBeenCalledOnce();
});
