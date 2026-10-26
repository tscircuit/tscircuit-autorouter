import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import { getPipeline9PhysicalGeometryContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalGeometryContext"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("MultiHead seeds same-root branches without inventing foreign crossings", () => {
  const coordinates = [
    [
      [-1.5, 0],
      [1.5, 0],
    ],
    [
      [0, -1.5],
      [0, 1.5],
    ],
    [
      [-1.2, -1.2],
      [1.2, 1.2],
    ],
  ]
  const points = coordinates.flatMap((pair, index) =>
    pair.map(([x, y], end) => ({
      x,
      y,
      z: 0,
      connectionName: `root_mst${index}`,
      rootConnectionName: "root",
      portPointId: `p${index}-${end}`,
    })),
  )
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "same-root-crossing",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: points,
    portPointsInPairs: coordinates.map((_, index) => [
      points[2 * index]!,
      points[2 * index + 1]!,
    ]),
  }
  const connMap = new ConnectivityMap({
    sameNet: ["root", "root_mst0", "root_mst1", "root_mst2"],
  })
  const physicalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [],
    connections: coordinates.map((_, index) => ({
      name: `root_mst${index}`,
      __rootConnectionNames: ["root"],
      pointsToConnect: [],
    })),
  }
  const validate = createPipeline9PhysicalRouteValidator({
    physicalSrj,
    connMap: getPipeline9PhysicalGeometryContext(physicalSrj).connMap,
    obstacleMargin: 0.15,
  })

  for (const mode of ["root", "connectivity"] as const) {
    const input = structuredClone(node)
    if (mode === "connectivity") {
      for (const point of input.portPoints) delete point.rootConnectionName
    }
    const solver = new MultiHeadPolyLineIntraNodeSolver3({
      nodeWithPortPoints: input,
      connMap: mode === "connectivity" ? connMap : undefined,
    })
    expect(solver.failed).toBe(false)
    expect(solver.minViaCount).toBe(0)
    const seed = solver.createInitialCandidateFromSeed(0)!
    expect(seed.viaCount).toBe(0)
    expect(solver.checkIfSolved(seed)).toBe(true)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(
      solver.solvedRoutes.map((route) => route.connectionName).sort(),
    ).toEqual(["root_mst0", "root_mst1", "root_mst2"])
    expect(solver.solvedRoutes.every((route) => route.vias.length === 0)).toBe(
      true,
    )
    expect(validate(solver.solvedRoutes)).toBe(true)
  }

  const base = new MultiHeadPolyLineIntraNodeSolver({
    nodeWithPortPoints: node,
  })
  base.setupInitialPolyLines()
  expect(base.candidates[0]?.viaCount).toBe(0)
  expect(base.checkIfSolved(base.candidates[0]!)).toBe(true)

  const foreignNode = structuredClone(node)
  for (const point of foreignNode.portPoints) delete point.rootConnectionName
  const foreign = new MultiHeadPolyLineIntraNodeSolver3({
    nodeWithPortPoints: foreignNode,
  })
  expect(foreign.minViaCount).toBe(6)
  expect(foreign.failed).toBe(true)
})
