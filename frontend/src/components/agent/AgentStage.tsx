"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUp, Code2, ListChecks, Search, Square } from "lucide-react";

import { HarnessBar } from "@/components/agent/HarnessBar";
import { ChatComposer } from "@/components/agent/ChatComposer";
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
import { Button, KbdChord } from "@/components/ui";
import { chordCaps, useIsMac } from "@/components/shell/keys";

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

  const [instruction, setInstruction] = useState("");
  const [showRunDetail, setShowRunDetail] = useState(false);
  const savedRunFor = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Streaming follows the bottom only while the person is already there; once
  // they scroll up to read, nothing moves under them (experience.md).
  const stickToBottom = useRef(true);
  const mac = useIsMac();
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const applySuggestion = (prompt: string) => {
    setInstruction(prompt);
    composerRef.current?.focus();
  };

  useEffect(() => {
    if (!hydrated) void hydrate().catch(() => undefined);
  }, [hydrated, hydrate]);

  useEffect(() => {
    setInstruction("");
    setShowRunDetail(false);
    savedRunFor.current = null;
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

  // One "run detail" control per run. A finished run saved on a chat message is
  // offered by that message (HistoricalRunDetail); the stage only offers it for
  // a run that has no message to carry it — one still in flight.
  const stageDetailId = useId();
  const runSavedOnMessage = Boolean(run.runId) && messages.some((m) => m.runId === run.runId);
  const showStageDetailControl =
    live ||
    ((run.status === "complete" || run.status === "error" || run.status === "stopped") &&
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
    if (activeThreadId !== null) return;
    reset();
    composerRef.current?.focus();
  }, [activeThreadId, reset]);

  useEffect(() => {
    setRunning(live);
  }, [live, setRunning]);

  // Persist assistant reply onto the thread when a run finishes.
  useEffect(() => {
    if (!activeThreadId) return;
    if (live) return;
    if (!run.runId) return;
    if (run.status !== "complete" && run.status !== "error" && run.status !== "stopped") {
      return;
    }
    if (savedRunFor.current === run.runId) return;
    const text = summarizeRunOutput(run);
    if (!text) return;
    savedRunFor.current = run.runId;
    appendMessage(activeThreadId, {
      role: "assistant",
      content: text,
      // Only worth naming when Auto picked it — a person's own pick is
      // already named by the chip, so repeating it on every reply would be
      // noise rather than information.
      providerLabel: provider && !provider.chosen ? provider.label : undefined,
      // Harness-graph runs persist a replayable event log server-side
      // (ExecutionLog); a direct/no-harness turn does not, so this id
      // 404s there — HistoricalRunDetail handles that by simply not
      // offering the toggle rather than erroring.
      runId: run.runId ?? undefined,
    });
  }, [activeThreadId, appendMessage, live, run, provider]);

  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live, run.status]);

  // A new conversation, or the person's own message, always returns to the bottom.
  useEffect(() => {
    stickToBottom.current = true;
  }, [activeThreadId]);

  const canStart =
    !live &&
    !!provider &&
    instruction.trim().length > 0 &&
    (!enabled || graph.nodes.length > 0);

  /** A `/` Tool was chosen: one run whose first act is the preset (contract §2.4).
      `exec` parks on the approval gate; the user sees the card before anything runs. */
  const onPreset = async (preset: ToolPreset) => {
    if (live || !provider) return;
    const label =
      preset.name === "exec" ? "/exec " + preset.argv.join(" ") : preset.name === "read" ? "/read " + preset.path : "/ls";
    const threadId = activeThreadId ?? createThread(label.slice(0, 60));
    appendMessage(threadId, { role: "user", content: label });
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
      tools: { preset, summarize: false, thread_id: threadId, permission_mode: permissionMode },
    });
  };

  const onStart = () => {
    if (!canStart || !provider) return;
    const text = instruction.trim();
    // The thread is born from the first message, not from a "New chat" click,
    // so the list never fills with empty "New chat" rows.
    stickToBottom.current = true;
    const threadId = activeThreadId ?? createThread(text.slice(0, 60));
    if (!activeThreadId) void permission.adopt(threadId);
    appendMessage(threadId, { role: "user", content: text });
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
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-12"
      >
        {messages.length === 0 && !live ? (
          <div className="oh-agent-welcome mx-auto flex w-full max-w-[680px] flex-col pt-[clamp(2rem,10vh,7rem)]">
            <div className="mb-6 flex items-end justify-between gap-8">
              <div className="min-w-0 max-w-[560px]">
                <h1 className="t-display text-display text-ink">What are we working on?</h1>
                <p className="mt-2 text-reading text-ink-mute">Describe a task, or pick one to start.</p>
              </div>
              <Nilo className="hidden flex-none sm:block" />
            </div>

            <ul className="divide-y divide-line-soft border-y border-line-soft" aria-label="Starting prompts">
              {suggestions.map(({ icon: Icon, title, prompt }) => (
                <li key={title}>
                  <button
                    type="button"
                    className="oh-focus-inner group flex min-h-control-lg w-full items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-sub-100"
                    onClick={() => applySuggestion(prompt)}
                  >
                    <span className="grid h-8 w-8 place-items-center text-ink-mute transition-colors group-hover:text-signal-text">
                      <Icon size={16} strokeWidth={1.7} aria-hidden />
                    </span>
                    <span className="text-title text-ink-dim group-hover:text-ink">{title}</span>
                  </button>
                </li>
              ))}
            </ul>

            <p className="mt-4 flex min-h-control-md items-center text-body text-ink-mute">
              {provider ? (
                <>
                  {enabled ? `${activeBundle?.manifest?.name ?? "Your harness"} · ` : "Direct · "}
                  <span className="ml-1 text-ink-dim">{provider.label}</span>
                </>
              ) : (
                <Button variant="ghost" size="sm" className="-ml-2 text-signal-text" onClick={() => requestProviderSetup(missing?.id ?? null)}>
                  {missing?.text ?? "Connect a provider to send"}
                </Button>
              )}
            </p>
          </div>
        ) : (
          <div role="log" aria-label="Conversation" aria-busy={live || undefined} className="mx-auto flex max-w-[760px] flex-col gap-6 pb-6 pt-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={[
                  "flex max-w-[88%] flex-col gap-1.5 max-sm:max-w-full",
                  m.role === "user" ? "self-end px-4 py-3 oh-agent-message--user" : "self-start pl-4 oh-agent-message--assistant",
                ].join(" ")}
              >
                <span className="text-body font-medium text-ink-mute">
                  {m.role === "user" ? "You" : m.providerLabel ? `OHarness · ${m.providerLabel}` : "OHarness"}
                </span>
                <div className={["max-w-[68ch] whitespace-pre-wrap break-words text-reading", m.role === "user" ? "text-ink" : "text-ink-dim"].join(" ")}>
                  {m.content}
                </div>
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

            {live && (
              <div className="flex flex-col gap-1">
                <ThinkingStatus
                  state={gateSeg ? "waiting" : "thinking"}
                  detail={enabled ? "Walking the harness graph." : "Waiting on the provider."}
                  elapsed={elapsed}
                  tokens={run.totals.tokens}
                />
                {gateSeg && (
                  <div className="mt-2">
                    <Gate segment={gateSeg} onResolve={resolveGate} />
                  </div>
                )}
              </div>
            )}

            {showStageDetailControl && <RunDetailToggle open={showRunDetail} onToggle={() => setShowRunDetail((v) => !v)} controlsId={stageDetailId} />}

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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 pb-2.5 pt-1">
            <HarnessBar />
            <ChatProviderPicker onConnect={() => goToProviders("providers")} />
            <WorkspacePicker />
            <span className="flex-1" />
            {missing ? (
              <Button variant="ghost" size="sm" onClick={() => requestProviderSetup(missing.id)} title={missing.text} className="min-w-0 max-w-[240px] text-signal-text max-sm:hidden">
                <span className="truncate">{missing.text}</span>
              </Button>
            ) : (
              <span className="flex items-center gap-1.5 text-meta text-ink-mute max-sm:hidden">
                <KbdChord caps={chordCaps("Mod+Enter", mac)} /> to send
              </span>
            )}
            {live ? (
              <Button iconOnly size="lg" onClick={stop} aria-label="Stop run" title="Stop run" icon={<Square size={11} strokeWidth={2} fill="currentColor" aria-hidden />} />
            ) : (
              <Button
                iconOnly
                size="lg"
                variant="primary"
                disabled={!canStart}
                onClick={onStart}
                title={!canStart ? (missing ? missing.text : "Type a message to send") : "Send message"}
                aria-label="Send message"
                icon={<ArrowUp size={16} strokeWidth={2.2} aria-hidden />}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
