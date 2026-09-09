/**
 * Same-origin bundle API client.
 *
 * Paths match `harnessSessionStore.hydrate` (`/bundles/default`) and the
 * FastAPI router. Next rewrites proxy `/bundles/*` to the sidecar so the
 * browser never talks cross-origin to :8000 (same rule as `/api/run`).
 */

export interface OHarnessManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  tags: string[];
}

export interface OHarnessGraph {
  nodes: unknown[];
  edges: unknown[];
}

export interface OHarnessContent {
  prompts: Record<string, unknown>;
  agents: Record<string, unknown>;
  skills: Record<string, unknown>;
  hooks: Record<string, unknown>;
  commands: Record<string, unknown>;
  scripts: Record<string, unknown>;
}

export interface OHarnessBundle {
  schemaVersion: string;
  manifest: OHarnessManifest;
  graph: OHarnessGraph;
  content: OHarnessContent;
  runtime: {
    preferred: string;
    cli: string | null;
    env: unknown[];
    secrets: unknown[];
  };
  validation: { mockProfile: string };
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
}

export interface MockStep {
  nodeId: string;
  role: string;
  status: string;
  note: string;
}

export interface MockResult {
  ok: boolean;
  steps: MockStep[];
  errors?: string[];
}

const EMPTY_CONTENT: OHarnessContent = {
  prompts: {},
  agents: {},
  skills: {},
  hooks: {},
  commands: {},
  scripts: {},
};

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error((await res.text()).slice(0, 240) || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchDefault(): Promise<OHarnessBundle> {
  const res = await fetch("/bundles/default", { cache: "no-store" });
  return readJson<OHarnessBundle>(res);
}

export async function validateBundle(bundle: unknown): Promise<ValidateResult> {
  const res = await fetch("/bundles/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
  return readJson<ValidateResult>(res);
}

export async function mockBundle(bundle: unknown): Promise<MockResult> {
  const res = await fetch("/bundles/mock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
  return readJson<MockResult>(res);
}

/** Canvas / xyflow node → schema-tolerant graph node (role from type). */
export function canvasNodeToBundleNode(node: {
  id: string;
  type?: string;
  data?: { label?: string; [key: string]: unknown };
}): Record<string, unknown> {
  return {
    id: node.id,
    role: node.type ?? node.id,
    label: node.data?.label ?? node.id,
  };
}

export function canvasEdgeToBundleEdge(edge: {
  id: string;
  source: string;
  target: string;
}): Record<string, unknown> {
  return { id: edge.id, source: edge.source, target: edge.target };
}

/**
 * Compose an exportable `.oharness` from the live canvas graph plus content /
 * runtime stubs taken from a base bundle (usually the default or active one).
 */
export function composeBundleFromCanvas(
  base: OHarnessBundle | null,
  canvas: {
    nodes: Array<{
      id: string;
      type?: string;
      data?: { label?: string; [key: string]: unknown };
    }>;
    edges: Array<{ id: string; source: string; target: string }>;
    harnessMeta: { name: string; description: string };
  }
): OHarnessBundle {
  const fallback: OHarnessBundle = {
    schemaVersion: "1.0.0",
    manifest: {
      id: "openharness.studio.export",
      name: canvas.harnessMeta.name || "Untitled Harness",
      version: "0.1.0",
      description: canvas.harnessMeta.description || "",
      license: "MIT",
      tags: ["studio"],
    },
    graph: { nodes: [], edges: [] },
    content: { ...EMPTY_CONTENT },
    runtime: { preferred: "api", cli: null, env: [], secrets: [] },
    validation: { mockProfile: "default" },
  };

  const src = base ?? fallback;
  return {
    schemaVersion: src.schemaVersion || "1.0.0",
    manifest: {
      ...src.manifest,
      name: canvas.harnessMeta.name || src.manifest.name,
      description: canvas.harnessMeta.description || src.manifest.description,
    },
    graph: {
      nodes: canvas.nodes.map(canvasNodeToBundleNode),
      edges: canvas.edges.map(canvasEdgeToBundleEdge),
    },
    content: src.content ?? { ...EMPTY_CONTENT },
    runtime: src.runtime ?? fallback.runtime,
    validation: src.validation ?? fallback.validation,
  };
}

export function downloadOHarness(bundle: OHarnessBundle, filename?: string): void {
  const name =
    filename ??
    `${(bundle.manifest.name || "harness").replace(/\s+/g, "_")}.oharness`;
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".oharness") ? name : `${name}.oharness`;
  a.click();
  URL.revokeObjectURL(url);
}

export function isOHarnessBundle(value: unknown): value is OHarnessBundle {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const manifest = v.manifest as Record<string, unknown> | undefined;
  return typeof manifest?.id === "string" && typeof v.schemaVersion === "string";
}
