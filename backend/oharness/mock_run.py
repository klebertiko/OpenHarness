from collections import defaultdict, deque
from dataclasses import dataclass

from .models import HarnessBundle


@dataclass
class MockStep:
    nodeId: str
    role: str
    status: str  # "planned" | "skipped"
    note: str


@dataclass
class MockRunReport:
    steps: list[MockStep]
    ok: bool


def _topological_sort(
    nodes: list[dict], edges: list[dict]
) -> tuple[list[str], list[str]]:
    """Kahn's algorithm. Returns (execution order, unreachable node ids)."""
    graph: dict[str, list[str]] = defaultdict(list)
    in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}

    for edge in edges:
        if edge["source"] not in in_degree or edge["target"] not in in_degree:
            continue
        graph[edge["source"]].append(edge["target"])
        in_degree[edge["target"]] += 1

    queue = deque(nid for nid, deg in in_degree.items() if deg == 0)
    order: list[str] = []
    while queue:
        nid = queue.popleft()
        order.append(nid)
        for neighbor in graph[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    unreachable = [nid for nid in in_degree if nid not in set(order)]
    return order, unreachable


def plan_mock_run(bundle: HarnessBundle) -> MockRunReport:
    nodes = [n for n in bundle.graph.nodes if isinstance(n, dict) and n.get("id")]
    edges = [e for e in bundle.graph.edges if isinstance(e, dict)]

    order, unreachable = _topological_sort(nodes, edges)
    node_by_id = {n["id"]: n for n in nodes}

    steps: list[MockStep] = []
    for node_id in order:
        node = node_by_id[node_id]
        role = node.get("role") or node_id
        steps.append(
            MockStep(nodeId=node_id, role=role, status="planned", note="")
        )

    for node_id in unreachable:
        node = node_by_id.get(node_id, {})
        role = node.get("role") or node_id
        steps.append(
            MockStep(
                nodeId=node_id,
                role=role,
                status="skipped",
                note="unreachable (cycle or missing predecessor)",
            )
        )

    return MockRunReport(steps=steps, ok=len(unreachable) == 0)
