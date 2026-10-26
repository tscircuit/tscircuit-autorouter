import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { CoupledSharedEdgePlacementPlan, type MovableSharedEdgeFamily } from "lib/solvers/UniformPortDistributionSolver/CoupledSharedEdgePlacementPlan"
import { CoupledPortPlacementSolver } from "lib/solvers/UniformPortDistributionSolver/CoupledPortPlacementSolver"
import { PhysicalSharedEdgePlacement } from "lib/solvers/UniformPortDistributionSolver/PhysicalSharedEdgePlacement"
import type { PortPointWithOwnerPair, SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

test("coupled placement clears real neighboring-cell endpoints without a common incident region", (): void => {
  const fixture: {
    nodes: Omit<NodeWithPortPoints, "portPoints">[]
    events: { edge: SharedEdge; port: PortPoint; allowed: [number, number][] }[]
  } = JSON.parse(readFileSync(new URL("../fixtures/sample24/coupled-neighbor-endpoints.json", import.meta.url), "utf8"))
  const ports: PortPointWithOwnerPair[] = fixture.events.map(({ port, edge }) => ({
    ...port, ownerNodeIds: edge.ownerNodeIds, ownerPairKey: edge.ownerPairKey,
  }))
  const nodes: NodeWithPortPoints[] = fixture.nodes.map((node) => ({
    ...node, portPoints: ports.filter((port) => port.ownerNodeIds.includes(node.capacityMeshNodeId)).map((port) => ({ ...port })),
  }))
  const families: MovableSharedEdgeFamily[] = fixture.events.map(({ edge }, index) => ({
    edge, ports: [ports[index]!], movablePortIds: [ports[index]!.portPointId!],
  }))
  // These exact full faces were independently checked against every original
  // obstacle. No pad clips any of their domains; this fixture isolates coupling.
  const physical = new PhysicalSharedEdgePlacement({
    layerCount: 8, minTraceWidth: 0.1, bounds: { minX: 270, maxX: 290, minY: 60, maxY: 80 },
    obstacles: [], traces: [], connections: [
      { name: "source_net_altium_pcb_136", pointsToConnect: [] },
      { name: "source_net_altium_pcb_106", pointsToConnect: [] },
    ],
  }, 0.1)
  for (const [index, event] of fixture.events.entries()) {
    expect(physical.getAllowedIntervals(event.edge, { z: 1, width: 0.1, owner: physical.getOwner(ports[index]!) }))
      .toEqual(event.allowed)
  }
  expect(Math.hypot(ports[0]!.x - ports[1]!.x, ports[0]!.y - ports[1]!.y)).toBeLessThan(0.195)
  expect(Math.hypot(ports[2]!.x - ports[1]!.x, ports[2]!.y - ports[1]!.y)).toBeLessThan(0.195)
  expect(ports[0]!.ownerNodeIds.some((id) => ports[1]!.ownerNodeIds.includes(id))).toBe(false)
  expect(ports[2]!.ownerNodeIds.some((id) => ports[1]!.ownerNodeIds.includes(id))).toBe(false)
  const original = structuredClone({ ports, nodes, families })
  const plan = new CoupledSharedEdgePlacementPlan({ nodes, currentPorts: ports, families, physical })
  expect(plan.jobs.length).toBeGreaterThan(0)
  for (const job of plan.jobs) {
    const solver = new CoupledPortPlacementSolver(job.input)
    solver.solve()
    expect(solver.solved).toBe(true)
    plan.accept(job, solver.getOutput())
  }
  const positions = plan.getValidatedPositions()
  for (const first of [0, 2]) {
    const a = positions.get(ports[first]!.portPointId!)!, b = positions.get(ports[1]!.portPointId!)!
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(0.195)
    expect(physical.isPortClear({ ...ports[first]!, ...a })).toBe(true)
  }
  expect(physical.isPortClear({ ...ports[1]!, ...positions.get(ports[1]!.portPointId!)! })).toBe(true)
  expect({ ports, nodes, families }).toEqual(original)
})
