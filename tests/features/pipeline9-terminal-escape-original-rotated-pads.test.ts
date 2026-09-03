import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { applyPipeline9TerminalEscapeRelocations } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9TerminalEscapeRelocations"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { EvaluateRelaxedDrcResult } from "lib/testing/evaluate-relaxed-drc"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 terminal relocation stays inside original rotated copper, not its routing cover", (): void => {
  const terminalPad: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.254,
    height: 0.8128,
    ccwRotationDegrees: 225,
    layers: ["top"],
    connectedTo: ["pcb_smtpad_0", "pcb_port_start"],
    circuitJsonMetadata: {
      pcb_smtpad_id: "pcb_smtpad_0",
      pcb_port_id: "pcb_port_start",
    },
  }
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, minY: -1, maxX: 3, maxY: 1 },
    obstacles: [terminalPad, {
      ...terminalPad,
      center: { x: 0.35, y: 0.35 },
      connectedTo: ["pcb_smtpad_1", "foreign_net"],
      circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_1" },
    }],
    connections: [{
      name: "signal",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_start" },
        { x: 2, y: 0, layer: "top" },
      ],
    }],
  }
  const routingSrj: SimpleRouteJson = addApproximatingRectsToSrj(originalSrj)
  const routes: HighDensityRoute[] = [{
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_start" },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }]
  const evaluatedTerminals: HighDensityRoute["route"] = []
  const connMap: ReturnType<typeof getConnectivityMapFromSimpleRouteJson> = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes }): EvaluateRelaxedDrcResult => {
    const candidateRoutes: HighDensityRoute[] | undefined = routes ?? hdRoutes
    if (!candidateRoutes) throw new Error("Missing terminal candidate geometry")
    evaluatedTerminals.push({ ...candidateRoutes[0]!.route[0]! })
    return evaluateRelaxedDrc({
      inputSrj: originalSrj,
      srjWithPointPairs: originalSrj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: originalSrj.connections,
        originalConnections: originalSrj.connections,
        hdRoutes: candidateRoutes,
        layerCount: 2,
        obstacles: originalSrj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap,
      }),
    })
  }
  const result: ReturnType<typeof applyPipeline9TerminalEscapeRelocations> = applyPipeline9TerminalEscapeRelocations({
    srj: routingSrj,
    originalObstacles: originalSrj.obstacles,
    routes,
    newConnections: routingSrj.connections,
    syntheticConnectionNames: new Set(),
    drcEvaluator,
  })

  expect(routingSrj.obstacles.length).toBeGreaterThan(originalSrj.obstacles.length)
  expect(result.attemptedCandidateCount).toBeGreaterThan(0)
  expect(evaluatedTerminals.some((point): boolean => point.x !== 0 || point.y !== 0)).toBeTrue()
  const radians: number = (225 * Math.PI) / 180
  for (const point of evaluatedTerminals) {
    const localX: number = point.x * Math.cos(radians) + point.y * Math.sin(radians)
    const localY: number = -point.x * Math.sin(radians) + point.y * Math.cos(radians)
    expect(Math.abs(localX) + 0.075).toBeLessThanOrEqual(terminalPad.width / 2)
    expect(Math.abs(localY) + 0.075).toBeLessThanOrEqual(terminalPad.height / 2)
    expect(point.pcb_port_id).toBe("pcb_port_start")
  }
  expect(result.routes[0]!.route.at(-1)).toEqual(routes[0]!.route.at(-1))
  expect(result.acceptedCandidateCount).toBeGreaterThan(0)
})
