import { expect, test } from "bun:test"
import { CoupledSharedEdgePlacementPlan } from "lib/solvers/UniformPortDistributionSolver/CoupledSharedEdgePlacementPlan"
import { CoupledPortPlacementSolver } from "lib/solvers/UniformPortDistributionSolver/CoupledPortPlacementSolver"
import { PhysicalSharedEdgePlacement } from "lib/solvers/UniformPortDistributionSolver/PhysicalSharedEdgePlacement"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

function finish(
  plan: CoupledSharedEdgePlacementPlan,
): Map<string, { x: number; y: number }> {
  for (const job of plan.jobs) {
    const solver = new CoupledPortPlacementSolver(job.input)
    solver.solve()
    expect(solver.solved).toBe(true)
    plan.accept(job, solver.getOutput())
  }
  return plan.getValidatedPositions()
}

function createPlan(
  anchorX: number,
  faceX: number,
  sameOwner: boolean,
  singleton = false,
): CoupledSharedEdgePlacementPlan {
  const width = singleton ? 0.3 : 0.1
  const srj: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: width,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [],
    traces: [],
    connections: [
      { name: "A", pointsToConnect: [] },
      { name: "B", pointsToConnect: [] },
    ],
  }
  const physical = new PhysicalSharedEdgePlacement(srj, width)
  if (singleton) physical.getAllowedIntervals = () => [[0.105, 0.105]]
  const a = {
    portPointId: "anchor",
    x: anchorX,
    y: 0.5,
    z: 0,
    connectionName: "A",
    rootConnectionName: "A",
  }
  const b = {
    portPointId: "moving",
    x: faceX,
    y: singleton ? 0.105 : 0.2,
    z: 0,
    connectionName: sameOwner ? "A" : "B",
    rootConnectionName: sameOwner ? "A" : "B",
  }
  const pair: [string, string] = ["left", "right"]
  const current = [a, b].map((port) => ({
    ...port,
    ownerNodeIds: pair,
    ownerPairKey: "left|right",
  })) as PortPointWithOwnerPair[]
  const original = current.map((port) =>
    port.portPointId === "moving" && !singleton
      ? { ...port, y: 0.8 }
      : { ...port },
  )
  const edge: SharedEdge = {
    ownerNodeIds: pair,
    ownerPairKey: "left|right",
    orientation: "vertical",
    x1: faceX,
    x2: faceX,
    y1: 0,
    y2: 1,
    length: 1,
    center: { x: faceX, y: 0.5 },
    nodeSideByOwnerId: { left: "right", right: "left" },
  }
  const nodes = [
    {
      capacityMeshNodeId: "left",
      center: { x: faceX - 0.5, y: 0.5 },
      width: 1,
      height: 1,
      availableZ: [0],
      portPoints: [a, b],
      portPointsInPairs: [],
    },
  ] as NodeWithPortPoints[]
  return new CoupledSharedEdgePlacementPlan({
    nodes,
    currentPorts: current,
    physical,
    families: [{ edge, ports: original, movablePortIds: ["moving"] }],
  })
}

test("coupled face order retains fixed anchors, exact singleton domains and off-face world positions", (): void => {
  const foreign = finish(createPlan(0, 0, false))
  expect(foreign.get("anchor")).toEqual({ x: 0, y: 0.5 })
  expect(foreign.get("moving")!.y).toBeGreaterThanOrEqual(0.695)
  const sameOwner = finish(createPlan(0, 0, true))
  expect(sameOwner.get("anchor")).toEqual({ x: 0, y: 0.5 })
  expect(sameOwner.get("moving")!.y).toBeGreaterThanOrEqual(0.5)
  const offFace = finish(createPlan(-0.3, 0, false))
  expect(offFace.get("anchor")).toEqual({ x: -0.3, y: 0.5 })
  expect(offFace.get("moving")).toEqual({ x: 0, y: 0.2 })
  const rounded = finish(createPlan(0.1 + 0.2, 0.3, false))
  expect(rounded.get("anchor")).toEqual({ x: 0.1 + 0.2, y: 0.5 })
  expect(rounded.get("moving")!.y).toBeGreaterThanOrEqual(0.695)
  const tangent = finish(createPlan(0, 0, false, true))
  expect(tangent.get("moving")).toEqual({ x: 0, y: 0.105 })
  expect(tangent.get("anchor")).toEqual({ x: 0, y: 0.5 })
})
