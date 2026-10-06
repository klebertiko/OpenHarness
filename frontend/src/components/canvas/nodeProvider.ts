import type { Connection } from "@/components/providers/providerStore";
import { chatProviderStatus } from "@/components/agent/chatProvider";
import type { ExecutionMode, NodeData } from "@/lib/types";

/** One line under a node: which connection runs it, with which model, and
    whether that can work right now. A node's own model satisfies a
    connection that has no default (backend/providers/resolution.py: the
    node's model wins, the connection's defaultModel is the fallback). */
export function nodeProviderSummary(data: NodeData, mode: ExecutionMode, connections: Connection[]): string {
  if (mode === "mock") return "Simulation · no provider called";
  const pin = data.providerIds?.[0];
  if (!pin) return "No connection pin · required in Studio";
  const connection = connections.find(item => item.id === pin);
  if (!connection) return pin + " · Unavailable";
  const model = data.model || connection.defaultModel;
  // Judge the connection as if it had the model the node will actually send.
  const status = chatProviderStatus(model ? { ...connection, defaultModel: model } : connection);
  return [connection.label, model, status].filter(Boolean).join(" · ");
}
