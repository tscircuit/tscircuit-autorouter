import { expect, test } from "bun:test"
import { lockHdRouteTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/lock-hd-route-terminals"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { createPipeline9PadAreaTerminalInput } from "./fixtures/createPipeline9PadAreaTerminalInput"

test("Pipeline9 carries a pad-area landing through MST and native pathing into stitching and terminal locking", (): void => {
  const srj = createPipeline9PadAreaTerminalInput()
  const inputBefore = structuredClone(srj)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  const originalBefore = structuredClone(pipeline.originalSrj)
  while (
    !pipeline.failed &&
    !pipeline.solved &&
    pipeline.getCurrentPhase() !== "uniformPortDistributionSolver"
  ) {
    const previousIterations = pipeline.iterations
    pipeline.step()
    if (pipeline.iterations <= previousIterations) {
      throw new Error("Pad-area fixture pipeline did not advance a normal step")
    }
  }
  expect(pipeline.failed).toBeFalse()
  expect(pipeline.getCurrentPhase()).toBe("uniformPortDistributionSolver")
  expect(pipeline.netToPointPairsSolver?.solved).toBeTrue()
  expect(pipeline.portPointPathingSolver?.solved).toBeTrue()
  const pairedSrj = pipeline.srjWithPointPairs
  const pathing = pipeline.portPointPathingSolver
  if (!pairedSrj || pairedSrj.connections.length !== 1 || !pathing?.solved) {
    throw new Error("Pad-area fixture requires one pair and solved native pathing")
  }
  const connection = pairedSrj.connections[0]!
  const landing = connection.pointsToConnect.find(
    (point): boolean => point.pcb_port_id === "pcb-a",
  )
  const other = connection.pointsToConnect.find(
    (point): boolean => point.pcb_port_id === "pcb-b",
  )
  if (!landing || !other || !("layer" in landing) || !("layer" in other)) {
    throw new Error("Pad-area fixture requires both original single-layer IDs")
  }
  expect(landing.x).toBeCloseTo(0.63, 12)
  expect(landing.y).toBe(0)
  expect(landing.layer).toBe("top")
  expect(landing.pointId).toBe("logical-a")
  expect(connection.name).toBe("net-a")
  const nativeTerminals = pathing.getOutput().nodesWithPortPoints.flatMap(
    (node): typeof node.portPoints =>
      node.portPoints.filter((point): boolean => point.pcb_port_id === "pcb-a"),
  )
  expect(nativeTerminals.length).toBeGreaterThan(0)
  for (const terminal of nativeTerminals) {
    expect(terminal.x).toBe(landing.x)
    expect(terminal.y).toBe(landing.y)
    expect(terminal.z).toBe(0)
    expect(terminal.connectionName).toBe(connection.name)
  }

  const route: HighDensityIntraNodeRoute = {
    connectionName: connection.name,
    traceThickness: srj.minTraceWidth,
    viaDiameter: 0.3,
    route: [
      { x: landing.x, y: landing.y, z: 0 },
      { x: other.x, y: other.y, z: 0 },
    ],
    vias: [],
  }
  const routeBefore = structuredClone(route)
  const stitch = new MultipleHighDensityRouteStitchSolver3({
    connections: pairedSrj.connections,
    hdRoutes: [route],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  stitch.solve()
  expect(stitch.failed).toBeFalse()
  expect(stitch.solved).toBeTrue()
  expect(stitch.mergedHdRoutes).toHaveLength(1)
  const locked = lockHdRouteTerminals(
    stitch.mergedHdRoutes,
    pairedSrj.connections,
  )[0]!
  expect(locked.route).toHaveLength(2)
  expect(locked.vias).toEqual([])
  const lockedLanding = locked.route.find(
    (point): boolean => point.pcb_port_id === "pcb-a",
  )
  expect(lockedLanding).toEqual({
    x: landing.x,
    y: landing.y,
    z: 0,
    pcb_port_id: "pcb-a",
  })
  for (const point of locked.route) {
    expect(point.x === 0.875 && point.y === 0).toBeFalse()
  }
  expect(route).toEqual(routeBefore)
  expect(pipeline.originalSrj).toEqual(originalBefore)
  expect(srj).toEqual(inputBefore)
})
