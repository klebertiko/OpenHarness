import type { Connection } from "@/components/providers/providerStore";
import { chatProviderStatus } from "@/components/agent/chatProvider";
import type { ExecutionMode, NodeData } from "@/lib/types";
export function nodeProviderSummary(data: NodeData, mode: ExecutionMode, connections: Connection[]): string {
  if (mode === "mock") return "Simulation · no provider called";
  const pin = data.providerIds?.[0];
  if (!pin) return "No connection pin · required in Studio";
  const connection = connections.find(item => item.id === pin);
  return connection ? connection.label + " · " + chatProviderStatus(connection) : pin + " · Unavailable";
}
