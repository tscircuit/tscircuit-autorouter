import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { applyPipeline9TerminalEscapeRelocations } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9TerminalEscapeRelocations"
import {
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcResult,
} from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("terminal escape repairs remove a pad collision without moving either endpoint", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          {
            x: 1.5,
            y: 1,
            layer: "top",
            pointId: "start",
            pcb_port_id: "start",
          },
          { x: 0, y: 0, layer: "top", pointId: "end", pcb_port_id: "end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 1.5, y: 1 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_1",
          pcb_port_id: "start",
        },
      },
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.8,
        height: 0.8,
        layers: ["top"],
        connectedTo: ["end"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_2",
          pcb_port_id: "end",
        },
      },
      {
        type: "rect",
        obstacleId: "pcb_smtpad_10",
        center: { x: 0.5, y: 0.6 },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["foreign"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_10" },
      },
    ],
  }
  const originalSrj = structuredClone(srj)
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const evaluate = (
    routes: HighDensityRoute[],
  ): EvaluateRelaxedDrcResult["errors"] =>
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: srj.connections,
        originalConnections: srj.connections,
        hdRoutes: routes,
        layerCount: srj.layerCount,
        obstacles: srj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap,
      }),
    }).errors

  for (const variant of [
    "start-bend",
    "end-bend",
    "start-direct",
    "end-direct",
  ]) {
    const route: HighDensityRoute = {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 1.5, y: 1, z: 0, pcb_port_id: "start" },
        { x: 0.55, y: 0.55, z: 0 },
        { x: 0, y: 0, z: 0, pcb_port_id: "end" },
      ],
      vias: [],
    }
    if (variant.endsWith("direct")) route.route.splice(1, 1)
    if (variant.startsWith("start")) route.route.reverse()
    // Width belongs to the outgoing segment. The last point's unused width
    // must not become a different copper width on a newly inserted segment.
    for (const point of route.route) point.traceThickness = 0.1
    route.route.at(-1)!.traceThickness = 0.2
    const originalRoute = structuredClone(route)
    const errors = evaluate([route])
    expect(errors.length).toBeGreaterThan(0)
    expect(
      errors.some((error) => JSON.stringify(error).includes("pcb_smtpad_10")),
    ).toBeTrue()
    const result = applyPipeline9TerminalEscapeRelocations({
      srj,
      originalSrj: srj,
      routes: [route],
      newConnections: srj.connections,
      syntheticConnectionNames: new Set(),
      drcEvaluator: ({ hdRoutes }) => {
        // Check every candidate, including candidates later rejected by DRC.
        expect(hdRoutes![0]!.route[0]).toEqual(originalRoute.route[0])
        expect(hdRoutes![0]!.route.at(-1)).toEqual(originalRoute.route.at(-1))
        return evaluate(hdRoutes!).map((error) => ({ ...error }))
      },
    })
    expect(result.acceptedCandidateCount).toBeGreaterThan(0)
    expect(result.remainingErrors).toEqual([])
    expect(evaluate(result.routes)).toEqual([])
    expect(result.routes[0]!.route[0]).toEqual(originalRoute.route[0])
    expect(result.routes[0]!.route.at(-1)).toEqual(originalRoute.route.at(-1))
    for (const point of result.routes[0]!.route.slice(0, -1)) {
      expect(point.traceThickness).toBe(0.1)
    }
    expect(route).toEqual(originalRoute)
    expect(srj).toEqual(originalSrj)
  }
})
