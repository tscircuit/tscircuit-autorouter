import { expect, test } from "bun:test"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { ExploredPortPoint } from "lib/solvers/NecessaryCrampedPortPointSolver/types"

const makeNode = (
  capacityMeshNodeId: string,
  overrides: Partial<CapacityMeshNode> = {},
): CapacityMeshNode => ({
  capacityMeshNodeId,
  center: { x: 0, y: 0 },
  width: 1,
  height: 1,
  availableZ: [0],
  layer: "top",
  ...overrides,
})

const makePort = ({
  id,
  nodeIds,
  cramped,
  x = 0,
  y = 0,
}: {
  id: string
  nodeIds: [string, string]
  cramped: boolean
  x?: number
  y?: number
}): SegmentPortPoint => ({
  segmentPortPointId: id,
  x,
  y,
  availableZ: [0],
  nodeIds,
  edgeId: id,
  connectionName: null,
  distToCentermostPortOnZ: 0,
  cramped,
})

const makeSegment = (portPoint: SegmentPortPoint): SharedEdgeSegment => ({
  edgeId: portPoint.edgeId,
  nodeIds: portPoint.nodeIds,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
  availableZ: [0],
  portPoints: [portPoint],
})

test("necessary cramped port selection preserves branches only for unmerged sparse source terminals", () => {
  const entry = makeNode("entry")
  const narrowExit = makeNode("narrow-exit", {
    width: 0.1,
    height: 0.1,
  })
  const openExit = makeNode("open-exit", { width: 10, height: 10 })
  const entryPort = makePort({
    id: "entry",
    nodeIds: ["target", "entry"],
    cramped: false,
  })
  const ports = [
    entryPort,
    makePort({
      id: "small-branch",
      nodeIds: ["entry", "narrow-exit"],
      cramped: true,
    }),
    makePort({
      id: "open-branch",
      nodeIds: ["entry", "open-exit"],
      cramped: true,
      x: 10,
      y: 10,
    }),
  ]
  const makeCandidate = (port: SegmentPortPoint): ExploredPortPoint => ({
    port,
    depth: 3,
    parent: {
      port: entryPort,
      depth: 2,
      parent: null,
      countOfCrampedPortPointsInPath: 0,
    },
    countOfCrampedPortPointsInPath: 1,
  })
  const getKeptPortIds = (connectedTo: string[]): string[] => {
    const target = makeNode("target", {
      _containsObstacle: true,
      _containsTarget: true,
      _connectedTo: connectedTo,
    })
    const solver = new MultiTargetNecessaryCrampedPortPointSolver({
      capacityMeshNodes: [target, entry, narrowExit, openExit],
      sharedEdgeSegments: ports.map(makeSegment),
      simpleRouteJson: {
        layerCount: 1,
        minTraceWidth: 0.1,
        bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
        obstacles: [],
        connections: [
          {
            name: "route",
            pointsToConnect: [
              { x: 0, y: 0, layer: "top" },
              { x: 100, y: 100, layer: "top" },
            ],
          },
        ],
      } satisfies SimpleRouteJson,
      numberOfCrampedPortPointsToKeep: 1,
    })
    Object.assign(solver, {
      activeSubSolver: {
        _step: () => {},
        solved: true,
        failed: false,
        getOutput: () => [makeCandidate(ports[1]), makeCandidate(ports[2])],
      },
      currentTarget: target,
      isRunningCrampedPass: true,
    })
    solver.solved = false
    solver._step()
    Object.assign(solver, { filteredOutput: undefined })
    return solver
      .getOutput()
      .flatMap((segment) => segment.portPoints)
      .map((portPoint) => portPoint.segmentPortPointId)
  }

  const sparseTerminalPortIds = getKeptPortIds([
    "connectivity_net1",
    "source_trace_1",
  ])
  expect(sparseTerminalPortIds).toContain("entry")
  expect(sparseTerminalPortIds).toContain("small-branch")
  expect(sparseTerminalPortIds).toContain("open-branch")

  const mergedTerminalPortIds = getKeptPortIds([
    "connectivity_net1",
    "source_trace_1",
    "source_net_1",
  ])
  expect(mergedTerminalPortIds).toContain("small-branch")
  expect(mergedTerminalPortIds).not.toContain("open-branch")
})
