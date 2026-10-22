"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUp, Code2, ListChecks, Search, Square } from "lucide-react";

import { HarnessBar } from "@/components/agent/HarnessBar";
import { ChatComposer, presetFromSlashText } from "@/components/agent/ChatComposer";
import { MessageActions } from "./MessageActions";
import { ModelPicker } from "@/components/providers/ModelPicker";
import { useChatTools } from "@/components/agent/useChatTools";
import { usePermissionMode } from "@/components/agent/usePermissionMode";
import { useWorkspaceTrust } from "@/components/agent/useWorkspaceTrust";
import type { ToolPreset } from "@/components/agent/chatCommands";
import { ChatProviderPicker } from "@/components/agent/ChatProviderPicker";
import { WorkspacePicker } from "@/components/agent/WorkspacePicker";
import { missingProviderAction, pickChatProvider } from "@/components/agent/chatProvider";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";
import { chosenWorkspace, useWorkspaceStore } from "@/store/workspaceStore";
import { Nilo } from "@/components/brand/Nilo";
import { ThinkingStatus } from "@/components/brand/ThinkingStatus";
import { Transcript } from "@/components/agent-run/Transcript";
import { HistoricalRunDetail } from "@/components/agent-run/HistoricalRunDetail";
import { RunDetailRegion, RunDetailToggle } from "@/components/agent-run/RunDetailToggle";
import { useRunStream } from "@/components/agent-run/useRunStream";
import { Gate } from "@/components/agent-run/Gate";
import { bundleGraphToEngine } from "@/lib/bundleGraph";
import { summarizeRunOutput } from "@/lib/summarizeRun";
import { useProviderStore } from "@/components/providers/providerStore";
import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";

/* Hallmark · genre: modern-minimal editorial workspace
   macrostructure: Quiet Desk · design-system: design.md · designed-as-app */
/**
 * Chats home — Cursor/Claude-like: messages for the active thread + composer.
 * The harness picker sits in the composer toolbar. Run ladder is optional.
 */
export function AgentStage() {
  const enabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const hydrated = useHarnessSessionStore((s) => s.hydrated);
  const hydrate = useHarnessSessionStore((s) => s.hydrate);

  const activeThreadId = useThreadStore((s) => s.activeThreadId);
  const createThread = useThreadStore((s) => s.createThread);
  const appendMessage = useThreadStore((s) => s.appendMessage);
  const messagesByThread = useThreadStore((s) => s.messagesByThread);

  const setRunning = useCanvasStore((s) => s.setRunning);
  const connections = useProviderStore((s) => s.connections);
  const chosenProviderId = useChatProviderStore((s) => s.chosenId);
  const goToProviders = useShellStore((s) => s.setSection);
  const workspace = useWorkspaceStore(chosenWorkspace);
  const provider = useMemo(
    () => pickChatProvider(connections, chosenProviderId),
    [connections, chosenProviderId],
  );
  // design.md § Provider stance: never a bare "Unavailable" — when nothing
  // resolves, the composer states exactly what's missing as an action, and
  // that action opens the combo's inline setup for the right connection.
  const missing = useMemo(
    () => missingProviderAction(connections, chosenProviderId),
    [connections, chosenProviderId],
  );
  const requestProviderSetup = useChatSetupRequestStore((s) => s.requestSetup);
  // Chat tools broker (contract v1.1): what `/` can offer for this workspace
  // with this connection. Absent workspace → the menu says why.
  const chatTools = useChatTools(
    workspace ? { rootPath: workspace.rootPath, name: workspace.name } : null,
    provider?.id,
  );

  // Permission mode of this conversation: selected here, enforced by the sidecar.
  const permission = usePermissionMode(activeThreadId);
  // Workspace trust (stored by the sidecar) only matters under Auto.
  const trust = useWorkspaceTrust(chatTools.workspace?.root ?? null, permission.mode === "auto_workspace");

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = activeThreadId ?? "new";
  const instruction = drafts[draftKey] ?? "";
  const setInstruction = (value: string) => setDrafts((current) => ({ ...current, [draftKey]: value }));
  const [modelChoices, setModelChoices] = useState<Record<string, string>>({});
  const selectedModel = provider ? modelChoices[provider.id] ?? "" : "";
  const connection = connections.find((c) => c.id === provider?.id) ?? null;
  const runOwner = useRef<{ threadId: string; instruction: string; providerLabel?: string } | null>(null);
  const [showRunDetail, setShowRunDetail] = useState(false);
  const savedRunFor = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const applySuggestion = (prompt: string) => {
    setInstruction(prompt);
    composerRef.current?.focus();
  };

  useEffect(() => {
    if (!hydrated) void hydrate().catch(() => undefined);
  }, [hydrated, hydrate]);

  useEffect(() => {
    setShowRunDetail(false);
    setFollowing(true);
  }, [activeThreadId]);

  const messages = useMemo(() => {
    if (!activeThreadId) return [];
    return messagesByThread[activeThreadId] ?? [];
  }, [activeThreadId, messagesByThread]);

  const graph = useMemo(
    () =>
      bundleGraphToEngine(
        activeBundle?.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined,
        instruction.trim() || undefined,
        provider?.id
      ),
    [activeBundle, instruction, provider]
  );

  const { run, elapsed, live, reset, start, stop, resolveGate } = useRunStream({
    graph,
    harnessEnabled: enabled,
  });
  const ownerThreadId = runOwner.current?.threadId ?? activeThreadId;
  const runInCurrentChat = ownerThreadId === activeThreadId;
  const liveAnswer = run.plan.flatMap((segment) => segment.blocks
    .filter((block) => block.kind === "text")
    .map((block) => block.text)).join("\n\n");

  // One "run detail" control per run. A finished run saved on a chat message is
  // offered by that message (HistoricalRunDetail); the stage only offers it for
  // a run that has no message to carry it — one still in flight.
  const stageDetailId = useId();
  const runSavedOnMessage = Boolean(run.runId) && messages.some((m) => m.runId === run.runId);
  const showStageDetailControl =
    (runInCurrentChat && live) ||
    (runInCurrentChat && (run.status === "complete" || run.status === "error" || run.status === "stopped") &&
      !runSavedOnMessage);

  const pendingToolApproval = run.plan.some((segment) =>
    segment.blocks.some((block) =>
      block.kind === "tool" && Boolean(block.call.approval) &&
      !block.call.approval?.decision && !block.call.denied
    )
  );

  useEffect(() => {
    if (pendingToolApproval) setShowRunDetail(true);
  }, [pendingToolApproval]);

  useEffect(() => {
    if (activeThreadId !== null || live) return;
    reset();
    runOwner.current = null;
    composerRef.current?.focus();
    // Navigation must not cancel a turn that still belongs to another chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, reset]);

  useEffect(() => {
    setRunning(live);
  }, [live, setRunning]);

  // Persist assistant reply onto the thread when a run finishes.
  useEffect(() => {
    if (!ownerThreadId) return;
    if (live) return;
    if (!run.runId) return;
    if (run.status !== "complete" && run.status !== "error" && run.status !== "stopped") {
      return;
    }
    if (savedRunFor.current === run.runId) return;
    const text = summarizeRunOutput(run);
    if (!text) return;
    savedRunFor.current = run.runId;
    // Deleting a chat while it runs must not resurrect its message bucket.
    if (!useThreadStore.getState().threads.some((thread) => thread.id === ownerThreadId)) return;
    appendMessage(ownerThreadId, {
      role: "assistant",
      content: text,
      // A harness may pin/fail over to a connection other than the chat default.
      // Prefer runtime evidence; the selected connection labels direct turns only.
      providerLabel: (() => {
        const segment = [...run.plan].reverse().find((segment) => segment.output?.trim());
        const actual = connections.find((connection) => connection.id === segment?.connectionId);
        if (actual) return [actual.label, segment?.model].filter(Boolean).join(" · ");
        if (runOwner.current) return runOwner.current.providerLabel
          ? [runOwner.current.providerLabel, segment?.model].filter(Boolean).join(" · ") : segment?.model || undefined;
        return provider && !provider.chosen ? provider.label : undefined;
      })(),
      // Harness-graph runs persist a replayable event log server-side
      // (ExecutionLog); a direct/no-harness turn does not, so this id
      // 404s there — HistoricalRunDetail handles that by simply not
      // offering the toggle rather than erroring.
      runId: run.runId ?? undefined,
    });
  }, [ownerThreadId, appendMessage, live, run, provider, connections]);

  useEffect(() => {
    if (following) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live, run.status, liveAnswer, following]);

  const slashPreset = presetFromSlashText(instruction);
  const canStart =
    !live &&
    !!provider &&
    instruction.trim().length > 0 &&
    !(slashPreset && "warning" in slashPreset) &&
    (!enabled || graph.nodes.length > 0 || Boolean(slashPreset && "preset" in slashPreset));

  /** A `/` Tool was chosen: one run whose first act is the preset (contract §2.4).
      `exec` parks on the approval gate; the user sees the card before anything runs. */
  const onPreset = async (preset: ToolPreset) => {
    if (live || !provider) return;
    const label =
      preset.name === "exec" ? "/exec " + preset.argv.join(" ") : preset.name === "read" ? "/read " + preset.path : "/ls";
    const threadId = activeThreadId ?? createThread(label.slice(0, 60));
    appendMessage(threadId, { role: "user", content: label });
    runOwner.current = { threadId, instruction: label, providerLabel: provider.label };
    setInstruction("");
    savedRunFor.current = null;
    // A brand-new conversation hands its chosen mode to the sidecar before the
    // run starts; the sidecar then takes the stricter of its stored mode and this one.
    const permissionMode = activeThreadId ? permission.mode : await permission.adopt(threadId);
    start({
      instruction: "",
      mode: provider.mode,
      step: false,
      cwd: workspace?.rootPath || undefined,
      providerId: provider.id,
      model: selectedModel || undefined,
      tools: { preset, summarize: false, thread_id: threadId, permission_mode: permissionMode },
    });
  };

  const onStart = () => {
    if (!canStart || !provider) return;
    if (slashPreset && "preset" in slashPreset) { void onPreset(slashPreset.preset); return; }
    const text = instruction.trim();
    // The thread is born from the first message, not from a "New chat" click,
    // so the list never fills with empty "New chat" rows.
    const threadId = activeThreadId ?? createThread(text.slice(0, 60));
    if (!activeThreadId) void permission.adopt(threadId);
    appendMessage(threadId, { role: "user", content: text });
    runOwner.current = { threadId, instruction: text, providerLabel: !enabled ? provider.label : undefined };
    setInstruction("");
    savedRunFor.current = null;
    // Chat is never mock: it runs against the connected provider. `provider.id`
    // is also the fallback carried into the graph above — one connection,
    // decided once here, never re-derived by the backend. useRunStream also
    // gets it directly (not re-derived from the graph) so it can report this
    // run's outcome back onto the same connection once it ends.
    start({
      instruction: text,
      mode: provider.mode,
      step: false,
      cwd: workspace?.rootPath || undefined,
      providerId: provider.id,
      model: !enabled ? selectedModel || undefined : undefined,
    });
  };

  const gateSeg = run.plan?.find((s) => s.state === "gate" && s.gate);
  const suggestions = [
    {
      icon: Code2,
      title: "Build something",
      prompt: "Help me plan and implement a feature in this project.",
    },
    {
      icon: ListChecks,
      title: "Work through a task",
      prompt: "Break this work into clear steps and take the first one.",
    },
    {
      icon: Search,
      title: "Understand a project",
      prompt: "Explore this project and explain the important parts to me.",
    },
  ];

  return (
    <div className="oh-agent-stage flex h-full min-h-0 flex-col">
      {live && !runInCurrentChat && <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-2 text-[12px] text-ink-mute">
        <span>A turn is still running in another chat.</span>
        <button type="button" onClick={() => ownerThreadId && useThreadStore.getState().selectThread(ownerThreadId)} className="rounded-control px-2 py-1 text-signal focus-visible:ring-2 focus-visible:ring-signal">Return to running chat</button>
      </div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-7 sm:px-8 lg:px-12" onScroll={(event) => {
        const element = event.currentTarget;
        setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 100);
      }}>
        {messages.length === 0 && !live ? (
          <div className="oh-agent-welcome mx-auto flex w-full max-w-[680px] flex-col pt-[clamp(4rem,13vh,9rem)]">
            <div className="mb-8 flex items-end justify-between gap-8">
              <div className="max-w-[560px]">
                <h1 className="t-display text-[clamp(2rem,3.6vw,3rem)] font-[600] leading-[1.08] text-ink">
                  What are we working on?
                </h1>
                <p className="mt-3 text-[14px] leading-6 text-ink-mute">Describe a task, or pick one to start.</p>
              </div>
              <Nilo className="hidden flex-none sm:block" />
            </div>

            <div className="divide-y divide-line-soft border-y border-line-soft">
              {suggestions.map(({ icon: Icon, title, prompt }) => (
                <button
                  key={title}
                  type="button"
                  className="group flex w-full items-center gap-3 px-1 py-3.5 text-left transition-colors hover:text-ink"
                  onClick={() => applySuggestion(prompt)}
                >
                  <span className="grid h-8 w-8 place-items-center text-ink-faint transition-colors group-hover:text-signal">
                    <Icon size={16} strokeWidth={1.7} aria-hidden />
                  </span>
                  <span className="text-[13px] font-[550] text-ink-dim group-hover:text-ink">{title}</span>
                </button>
              ))}
            </div>

            <p className="mt-5 text-[12px] text-ink-faint">
              {provider ? (
                <>
                  {enabled ? `${activeBundle?.manifest?.name ?? "Your harness"} · ` : "Direct · "}
                  <span className="text-ink-mute">{provider.label}</span>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => requestProviderSetup(missing?.id ?? null)}
                  className="font-[550] text-signal underline-offset-2 hover:underline"
                >
                  {missing?.text ?? "Connect a provider to send"}
                </button>
              )}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-7 pb-6 pt-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={[
                  "flex min-w-0 max-w-[95%] sm:max-w-[88%] flex-col gap-2",
                  m.role === "user" ? "self-end px-4 py-3 oh-agent-message--user" : "self-start pl-4 oh-agent-message--assistant",
                ].join(" ")}
              >
                <span className="text-[11px] font-[600] tracking-[0.02em] text-ink-faint">
                  {m.role === "user"
                    ? "You"
                    : m.providerLabel
                      ? `OpenHarness · ${m.providerLabel}`
                      : "OpenHarness"}
                </span>
                <div
                  className={[
                    "whitespace-pre-wrap text-[15px] leading-7 [overflow-wrap:anywhere]",
                    m.role === "user" ? "text-ink" : "text-ink-dim",
                  ].join(" ")}
                >
                  {m.content}
                </div>
                <MessageActions content={m.content} onReuse={!live ? () => applySuggestion(m.content) : undefined} />
                {m.role === "assistant" && m.runId && (
                  <HistoricalRunDetail
                    runId={m.runId}
                    // The run that just finished is still in memory: hand it
                    // over (and the detail the person already opened) so this
                    // is its only control and it needs no round trip.
                    run={m.runId === run.runId && !live ? run : undefined}
                    elapsed={m.runId === run.runId && !live ? elapsed : undefined}
                    defaultOpen={m.runId === run.runId && !live ? showRunDetail : false}
                  />
                )}
              </div>
            ))}

            {live && runInCurrentChat && (
              <div className="flex flex-col gap-1">
                <ThinkingStatus
                  state={gateSeg ? "waiting" : "thinking"}
                  detail={enabled ? "Walking the harness graph." : "Waiting on the provider."}
                  elapsed={elapsed}
                  tokens={run.totals.tokens}
                />
                {liveAnswer && <div role="region" aria-label="Live answer" className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-ink-dim [overflow-wrap:anywhere]">{liveAnswer}</div>}
                {gateSeg && (
                  <div className="mt-2">
                    <Gate segment={gateSeg} onResolve={resolveGate} />
                  </div>
                )}
              </div>
            )}

            {runInCurrentChat && (run.status === "error" || run.status === "stopped") && <div role={run.status === "error" ? "alert" : "status"} className="rounded-control border border-line-soft p-3 text-[13px] text-ink-mute">
              <p>{run.status === "error" ? "The turn failed. Check the provider connection, then reuse your instruction to try again." : "The turn stopped. You can reuse your instruction when ready."}</p>
              {run.notices?.map((notice, index) => <p key={index} className="mt-1 [overflow-wrap:anywhere]">{notice}</p>)}
              {runOwner.current?.instruction && <button type="button" onClick={() => applySuggestion(runOwner.current!.instruction)} className="mt-2 rounded-control border border-line px-2 py-1 text-ink focus-visible:ring-2 focus-visible:ring-signal">Reuse instruction</button>}
            </div>}

            {showStageDetailControl && (
              <RunDetailToggle
                open={showRunDetail}
                onToggle={() => setShowRunDetail((v) => !v)}
                controlsId={stageDetailId}
              />
            )}

            {showStageDetailControl && showRunDetail && (
              <RunDetailRegion id={stageDetailId}>
                <Transcript run={run} onResolve={resolveGate} elapsed={elapsed} />
              </RunDetailRegion>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="flex-none px-3 pb-4 pt-2 sm:px-6">
        {!following && <div className="mb-2 text-center"><button type="button" onClick={() => setFollowing(true)} className="rounded-control border border-line bg-sub-100 px-3 py-1 text-[12px] text-ink focus-visible:ring-2 focus-visible:ring-signal">Jump to latest</button></div>}
        <div className="oh-agent-composer mx-auto max-w-[820px]">
          <ChatComposer
            key={activeThreadId ?? "no-thread"}
            inputRef={composerRef}
            value={instruction}
            onChange={setInstruction}
            onSend={onStart}
            skills={activeBundle?.content?.skills}
            live={live}
            tools={chatTools}
            onPreset={onPreset}
            permissionMode={permission.mode}
            onPermissionModeChange={(mode) => void permission.setMode(mode)}
            permissionNotice={permission.error}
            workspaceTrust={chatTools.workspace ? { workspaceName: chatTools.workspace.name, trusted: trust.trusted, onChange: (value) => void trust.setTrusted(value), error: trust.error } : undefined}
          />
          {chatTools.loading && <p role="status" className="px-4 py-1 text-[11px] text-ink-faint">Checking workspace tools…</p>}
          {chatTools.error && <p role="status" className="px-4 py-1 text-[11px] text-warn">Workspace tools unavailable. Text chat is still available. {chatTools.error}</p>}
          {chatTools.capabilities && <p className="px-4 py-1 text-[11px] text-ink-faint">{chatTools.capabilities.reason === "ok" ? "Workspace tools available in / commands" : chatTools.capabilities.reason === "cli-adapter" ? "Workspace tools are managed by this provider’s CLI" : "This connection does not offer workspace tools"}</p>}
          <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5 pt-1">
            <fieldset disabled={live} aria-label="Run settings" className="contents disabled:opacity-60">
            <HarnessBar />
            <ChatProviderPicker disabled={live} onConnect={() => goToProviders("providers")} />
            <WorkspacePicker />
            {provider && !enabled && <div className="min-w-0 max-w-full sm:max-w-[220px]">
              <ModelPicker connection={connection} value={selectedModel} onChange={(model) => setModelChoices((current) => ({ ...current, [provider.id]: model }))}
                label="Model for next turn" inheritLabel="Connection default" inheritDetail={connection?.defaultModel || "The provider CLI chooses its model"} disabled={live}
                triggerClassName="h-8 max-w-full px-2 text-[11px] text-ink-dim" />
            </div>}
            </fieldset>
            <span className="flex-1" />
            {missing ? (
              <button
                type="button"
                onClick={() => requestProviderSetup(missing.id)}
                title={missing.text}
                className="hidden min-w-0 max-w-[240px] truncate text-[11px] font-[550] text-signal underline-offset-2 hover:underline sm:block"
              >
                {missing.text}
              </button>
            ) : (
              <span className="hidden text-[11px] text-ink-faint sm:inline">Ctrl ↵ to send</span>
            )}
            {live ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop run"
                title="Stop run"
                className="grid h-8 w-8 flex-none place-items-center rounded-[8px] border border-line text-ink-mute transition-colors hover:bg-sub-200 hover:text-ink"
              >
                <Square size={11} strokeWidth={2} fill="currentColor" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canStart}
                onClick={onStart}
                title={!canStart && missing ? missing.text : undefined}
                aria-label="Send message"
                className="grid h-8 w-8 flex-none place-items-center rounded-[8px] bg-signal text-signal-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ArrowUp size={16} strokeWidth={2.2} aria-hidden />
              </button>
            )}
          </div>
          <p className="px-4 pb-2 text-[11px] text-ink-faint">{enabled ? "Harness agents use their pinned models or connection defaults. " : `Model: ${selectedModel || connection?.defaultModel || "provider default"}. `}Each turn sends your instruction; earlier messages are not included automatically.</p>
        </div>
      </div>
    </div>
  );
}
