
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { automationsApi, type AutomationJob } from "@/lib/automationsApi";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { AutomationsPanel } from "./AutomationsPanel";

vi.mock("@/lib/automationsApi", () => ({
  automationsApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), runNow: vi.fn(), remove: vi.fn() },
}));
const initialLibrary=useHarnessLibraryStore.getState();
const initialSession=useHarnessSessionStore.getState();
const job: AutomationJob = { id:"job-1", name:"Daily plan", cron:"0 9 * * *", projectId:null, harnessBundleId:null, harnessEnabled:false, status:"complete", lastRunAt:"2026-09-13T09:00:00" };
beforeEach(() => {
  vi.resetAllMocks();
  useHarnessLibraryStore.setState({ hydrated:true, entries:[{id:"review",name:"Review harness",isDefault:false,addedAt:0,bundle:{manifest:{id:"review",name:"Review harness"}}}] });
  useHarnessSessionStore.setState({ activeBundle:null });
  vi.mocked(automationsApi.list).mockResolvedValue({jobs:[{...job}]});
});
afterEach(() => {cleanup();useHarnessLibraryStore.setState(initialLibrary);useHarnessSessionStore.setState(initialSession);});

it("Run simulation asks the sidecar for mock mode explicitly", async()=>{
  // AUTOMATE-CHECKPOINT (Codex PEDIDO 2026-09-18): the backend now defaults
  // to live when no mode is sent; a button that promises a simulation must
  // say so on the wire, not trust the server default.
  const user=userEvent.setup();
  vi.mocked(automationsApi.runNow).mockResolvedValue({...job});
  render(<AutomationsPanel/>);
  await user.click(await screen.findByRole("button",{name:/Daily plan/}));
  await user.click(screen.getByRole("button",{name:"Run simulation"}));
  expect(automationsApi.runNow).toHaveBeenCalledWith("job-1","mock");
});

it("identifies simulation mode and UTC without inventing a completed result after reload", async()=>{
  const user=userEvent.setup();
  render(<AutomationsPanel/>);
  await screen.findByRole("button",{name:/Daily plan/});
  expect(screen.getByText(/Simulation mode:/)).toBeTruthy();
  await user.click(screen.getByRole("button",{name:/Daily plan/}));
  expect(screen.getByRole("button",{name:"Run simulation"})).toBeTruthy();
  // Piece 3 (AUTOMATE-GAUNTLET): the old static "Schedules use UTC" sentence was
  // replaced by a genuinely computed, UTC-explicit next-run line — deliberately
  // updated here, not silently dropped. UTC is now disclosed at the point of use
  // (the time-input label) and in the computed next-run time itself.
  expect(screen.getByLabelText(/Trigger time \(UTC\)/i)).toBeTruthy();
  expect(screen.getByText(/09:00 UTC/)).toBeTruthy();
  expect(screen.queryByText(/chat.s default provider/)).toBeNull();
  await user.click(screen.getByRole("button",{name:"Last attempt"}));
  expect(screen.getByText("No result details are available for this attempt.")).toBeTruthy();
  expect(screen.queryByText("Completed")).toBeNull();
  expect(screen.queryByText(/Every run is also listed under Activity/)).toBeNull();
});


it("shows a real UTC next-run time for a daily schedule, computed via the wired nextRun helper",async()=>{
  const user=userEvent.setup();
  render(<AutomationsPanel/>);
  await screen.findByRole("button",{name:/Daily plan/});
  await user.click(screen.getByRole("button",{name:/Daily plan/}));
  // job.cron is "0 9 * * *" — a real nextRun() computation always lands on 09:00 UTC,
  // whatever today's date is. Today the Trigger section never imports nextRun at all.
  const next=screen.getByText(/Next run/);
  expect(next.textContent).toMatch(/09:00 UTC/);
});

it("never shows a fabricated next-run time for on-demand or custom schedules",async()=>{
  const user=userEvent.setup();
  render(<AutomationsPanel/>);
  await screen.findByRole("button",{name:/Daily plan/});
  // A fresh draft defaults to "On demand" (manual) — no cron, no next run.
  await user.click(screen.getByRole("button",{name:"New automation"}));
  expect(screen.getByText(/No scheduled next run — this automation only runs when you start it\./)).toBeTruthy();
  expect(screen.queryByText(/Next run:/)).toBeNull();
  // Custom cron isn't safely previewed either — say so, don't guess or go silent.
  await user.click(screen.getByRole("button",{name:"Custom cron"}));
  expect(screen.getByText(/Next run isn.t previewed for custom cron — it still evaluates in UTC on the server\./)).toBeTruthy();
  expect(screen.queryByText(/Next run:/)).toBeNull();
});

it("keeps drafts local and saves coherent harness settings explicitly, retaining input after failed writes",async()=>{
  const user=userEvent.setup();
  const created={...job,id:"job-2",name:"Morning review",harnessBundleId:"review",harnessEnabled:true,status:"idle",lastRunAt:null};
  vi.mocked(automationsApi.create).mockRejectedValueOnce(new Error("Create unavailable")).mockResolvedValue(created);
  vi.mocked(automationsApi.update).mockRejectedValueOnce(new Error("Save unavailable")).mockResolvedValue({...created,name:"Evening review",harnessBundleId:null,harnessEnabled:false});
  render(<AutomationsPanel/>);
  await screen.findByRole("button",{name:/Daily plan/});
  await user.click(screen.getByRole("button",{name:"New automation"}));
  await user.type(screen.getByRole("textbox",{name:"Automation name"}),"Morning review");
  await user.selectOptions(screen.getByRole("combobox"),"review");
  await user.click(screen.getByRole("button",{name:"Every day"}));
  expect(automationsApi.create).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Create automation"}));
  expect(automationsApi.create).toHaveBeenLastCalledWith({name:"Morning review",cron:"0 9 * * *",harnessBundleId:"review",harnessEnabled:true});
  expect((await screen.findByRole("alert")).textContent).toContain("Create unavailable");
  expect((screen.getByRole("textbox",{name:"Automation name"}) as HTMLInputElement).value).toBe("Morning review");
  await user.click(screen.getByRole("button",{name:"Create automation"}));
  await screen.findByRole("button",{name:"Save changes"});
  expect((screen.getByRole("combobox",{name:"Harness"}) as HTMLSelectElement).value).toBe("review");
  await user.clear(screen.getByRole("textbox",{name:"Automation name"}));
  await user.type(screen.getByRole("textbox",{name:"Automation name"}),"Evening review");
  await user.selectOptions(screen.getByRole("combobox",{name:"Harness"}),"");
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,600));});
  expect(automationsApi.update).not.toHaveBeenCalled();
  expect((screen.getByRole("button",{name:"Run simulation"}) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button",{name:"Save changes"}));
  expect(automationsApi.update).toHaveBeenLastCalledWith("job-2",{name:"Evening review",cron:"0 9 * * *",harnessBundleId:null,harnessEnabled:false});
  expect((await screen.findByRole("alert")).textContent).toContain("Save unavailable");
  expect((screen.getByRole("textbox",{name:"Automation name"}) as HTMLInputElement).value).toBe("Evening review");
  await user.click(screen.getByRole("button",{name:"Save changes"}));
  await waitFor(()=>expect((screen.getByRole("button",{name:"Save changes"}) as HTMLButtonElement).disabled).toBe(true));
  expect((screen.getByRole("button",{name:"Run simulation"}) as HTMLButtonElement).disabled).toBe(false);
});
