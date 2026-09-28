"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Code2, ListChecks, Search, Square } from "lucide-react";

import { HarnessBar } from "@/components/agent/HarnessBar";
import { ChatComposer } from "@/components/agent/ChatComposer";
import { useChatTools } from "@/components/agent/useChatTools";
import type { ToolPreset } from "@/components/agent/chatCommands";
import { ChatProviderPicker } from "@/components/agent/ChatProviderPicker";
import { WorkspacePicker } from "@/components/agent/WorkspacePicker";
import { pickChatProvider } from "@/components/agent/chatProvider";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { chosenWorkspace, useWorkspaceStore } from "@/store/workspaceStore";
import { Nilo } from "@/components/brand/Nilo";
import { ThinkingStatus } from "@/components/brand/ThinkingStatus";
import { Transcript } from "@/components/agent-run/Transcript";
import { HistoricalRunDetail } from "@/components/agent-run/HistoricalRunDetail";
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
  // Chat tools broker (contract v1.1): what `/` can offer for this workspace
  // with this connection. Absent workspace → the menu says why.
  const chatTools = useChatTools(
    workspace ? { rootPath: workspace.rootPath, name: workspace.name } : null,
    provider?.id,
  );

  const [instruction, setInstruction] = useState("");
  const [showRunDetail, setShowRunDetail] = useState(false);
  const savedRunFor = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
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
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live, run.status]);

  const canStart =
    !live &&
    !!provider &&
    instruction.trim().length > 0 &&
    (!enabled || graph.nodes.length > 0);

  /** A `/` Tool was chosen: one run whose first act is the preset (contract §2.4).
      `exec` parks on the approval gate; the user sees the card before anything runs. */
  const onPreset = (preset: ToolPreset) => {
    if (live || !provider) return;
    const label =
      preset.name === "exec" ? "/exec " + preset.argv.join(" ") : preset.name === "read" ? "/read " + preset.path : "/ls";
    const threadId = activeThreadId ?? createThread(label.slice(0, 60));
    appendMessage(threadId, { role: "user", content: label });
    setInstruction("");
    savedRunFor.current = null;
    start({
      instruction: "",
      mode: provider.mode,
      step: false,
      cwd: workspace?.rootPath || undefined,
      providerId: provider.id,
      tools: { preset, summarize: false },
    });
  };

  const onStart = () => {
    if (!canStart || !provider) return;
    const text = instruction.trim();
    // The thread is born from the first message, not from a "New chat" click,
    // so the list never fills with empty "New chat" rows.
    const threadId = activeThreadId ?? createThread(text.slice(0, 60));
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-7 sm:px-8 lg:px-12">
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
                <>
                  No provider connected.{" "}
                  <button
                    type="button"
                    onClick={() => goToProviders("providers")}
                    className="font-[550] text-signal underline-offset-2 hover:underline"
                  >
                    Connect one
                  </button>{" "}
                  to start a chat.
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-7 pb-6 pt-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={[
                  "flex max-w-[88%] flex-col gap-2",
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
                    "whitespace-pre-wrap text-[15px] leading-7",
                    m.role === "user" ? "text-ink" : "text-ink-dim",
                  ].join(" ")}
                >
                  {m.content}
                </div>
                {m.role === "assistant" && m.runId && (
                  <HistoricalRunDetail runId={m.runId} />
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

            {(run.status === "complete" ||
              run.status === "error" ||
              run.status === "stopped" ||
              live) && (
              <button
                type="button"
                onClick={() => setShowRunDetail((v) => !v)}
                className="self-start text-[12px] text-ink-faint underline-offset-2 hover:text-ink-mute hover:underline"
              >
                {showRunDetail ? "Hide run detail" : "Show run detail"}
              </button>
            )}

            {showRunDetail && (
              <div className="overflow-hidden rounded-panel border border-line bg-sub-100">
                <Transcript run={run} onResolve={resolveGate} />
              </div>
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
          />
          <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
            <HarnessBar />
            <ChatProviderPicker onConnect={() => goToProviders("providers")} />
            <WorkspacePicker />
            <span className="flex-1" />
            <span className="hidden text-[11px] text-ink-faint sm:inline">Ctrl ↵ to send</span>
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
                aria-label="Send message"
                className="grid h-8 w-8 flex-none place-items-center rounded-[8px] bg-signal text-signal-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ArrowUp size={16} strokeWidth={2.2} aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
