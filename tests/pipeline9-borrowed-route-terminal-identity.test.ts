import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { normalizePipeline9HdRouteTerminalIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9HdRouteTerminalIds"
import { repairDisconnectedSameRootPortPoints } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("defers borrowed same-net point identity normalization until stitching", (): void => {
  const ownTerminal: PortPoint = {
    x: 2,
    y: 0,
    z: 0,
    connectionName: "main",
    rootConnectionName: "shared-net",
    pcb_port_id: "own-terminal",
  }
  const interiorContact: PortPoint = {
    x: 0,
    y: 0,
    z: 0,
    connectionName: "main",
    rootConnectionName: "shared-net",
  }
  const siblingTerminal = {
    ...interiorContact,
    connectionName: "sibling",
    pcb_port_id: "other-terminal",
  }
  const siblingEnd = { ...ownTerminal, connectionName: "sibling" }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "shared-node",
    center: { x: 1, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [ownTerminal, interiorContact, siblingTerminal, siblingEnd],
    portPointsInPairs: [
      [ownTerminal, interiorContact],
      [siblingTerminal, siblingEnd],
    ],
  }
  const siblingRoute: HighDensityIntraNodeRoute = {
    connectionName: "sibling",
    rootConnectionName: "shared-net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [siblingTerminal, siblingEnd],
    vias: [],
  }
  const repairedRoutes = repairDisconnectedSameRootPortPoints(
    [siblingRoute],
    node,
  )
  expect(repairedRoutes.map((route) => route.connectionName)).toEqual([
    "sibling",
    "main",
  ])
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({ "shared-net": ["main", "sibling"] }),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    preserveTerminalPcbPortIds: true,
  })
  solver.activeNode = node
  ;(
    solver as unknown as {
      finishActiveNode: (routes: HighDensityIntraNodeRoute[]) => void
    }
  ).finishActiveNode(repairedRoutes)
  const mainRoute = solver.routes.find(
    (route) => route.connectionName === "main",
  )!
  expect(mainRoute.startPcbPortId).toBeUndefined()
  expect(mainRoute.route[0]!.pcb_port_id).toBe("other-terminal")
  expect(mainRoute.endPcbPortId).toBe("own-terminal")
  expect(mainRoute.route.at(-1)!.pcb_port_id).toBe("own-terminal")
  expect(mainRoute.route.map(({ x, y, z }) => ({ x, y, z }))).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ])
  const ownSiblingRoute = solver.routes.find(
    (route) => route.connectionName === "sibling",
  )!
  expect(ownSiblingRoute.route[0]!.pcb_port_id).toBe("other-terminal")
  expect(ownSiblingRoute.route.at(-1)!.pcb_port_id).toBe("own-terminal")

  const originalRoutes = structuredClone(solver.routes)
  const normalizedRoutes = normalizePipeline9HdRouteTerminalIds(solver.routes)
  const normalizedMain = normalizedRoutes.find(
    (route): boolean => route.connectionName === "main",
  )!
  expect(normalizedMain.route[0]!.pcb_port_id).toBeUndefined()
  expect(Object.hasOwn(normalizedMain.route[0]!, "pcb_port_id")).toBeFalse()
  expect(normalizedMain.route.at(-1)!.pcb_port_id).toBe("own-terminal")
  expect(solver.routes).toEqual(originalRoutes)

  const stitchSolver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "main",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "own-terminal" },
        ],
      },
      {
        name: "sibling",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "other-terminal" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "own-terminal" },
        ],
      },
    ],
    hdRoutes: normalizedRoutes,
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  stitchSolver.solve()
  expect(stitchSolver.solved).toBeTrue()
  expect(stitchSolver.failed).toBeFalse()
  const stitchedMain = stitchSolver.mergedHdRoutes.find(
    (route): boolean => route.connectionName === "main",
  )!
  expect(
    stitchedMain.route.map(
      ({ x, y, z }): { x: number; y: number; z: number } => ({ x, y, z }),
    ),
  ).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ])
  expect(stitchedMain.route[0]!.pcb_port_id).toBeUndefined()
  expect(stitchedMain.route.at(-1)!.pcb_port_id).toBe("own-terminal")
  expect(solver.routes).toEqual(originalRoutes)
})
