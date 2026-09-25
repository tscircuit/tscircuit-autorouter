import * as repair04 from "@tscircuit/repair04"
import { expect, spyOn, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("regional repair uses the board clearance when negotiating trace paths", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -4, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "vertical",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -2, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      vias: [],
    },
  ]
  const original = structuredClone(routes)
  const srj: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.3,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    obstacles: routes.flatMap((route) =>
      [route.route[0]!, route.route.at(-1)!].map((point, index) => ({
        type: "rect" as const,
        center: { x: point.x, y: point.y },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: [route.connectionName, `${route.connectionName}_${index}`],
        circuitJsonMetadata: {
          pcb_smtpad_id: `pad_${route.connectionName}_${index}`,
          pcb_port_id: `${route.connectionName}_${index}`,
        },
      })),
    ),
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
        (point, index) => ({
          ...point,
          layer: "top",
          pcb_port_id: `${route.connectionName}_${index}`,
        }),
      ),
    })),
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const drcEvaluator: DrcEvaluator = ({
    routes: candidate,
  }): ReturnType<DrcEvaluator> => {
    if (!candidate) throw new Error("Expected candidate routes")
    return evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: srj.connections,
        originalConnections: srj.connections,
        hdRoutes: candidate,
        layerCount: srj.layerCount,
        obstacles: srj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap,
      }),
      drcOptions: { traceClearance: srj.minTraceToPadEdgeClearance },
    }) as unknown as ReturnType<DrcEvaluator>
  }
  const negotiate = spyOn(repair04, "negotiateTraceClearance")
  let result: ReturnType<typeof applyPipeline9BoundedRegionalRepairs>
  try {
    result = applyPipeline9BoundedRegionalRepairs({
      originalSrj: srj,
      connMap,
      routes,
      syntheticConnectionNames: new Set(),
      drcEvaluator,
    })
    expect(negotiate).toHaveBeenCalled()
    for (const [input] of negotiate.mock.calls) {
      expect(input.traceClearance).toBe(0.3)
    }
  } finally {
    negotiate.mockRestore()
  }
  expect(result.initialDrcIssueCount).toBeGreaterThan(0)
  expect(result.finalDrcIssueCount).toBe(0)
  expect(result.repaired).toBeTrue()
  expect(result.publishedDrcIssueCount).toBe(0)
  expect(routes).toEqual(original)
  expect(result.routes).toHaveLength(original.length)
  for (let index = 0; index < original.length; index++) {
    const route = result.routes[index]!
    expect(route.route[0]).toEqual(original[index]!.route[0])
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    expect(route.traceThickness).toBe(original[index]!.traceThickness)
    expect(route.viaDiameter).toBe(original[index]!.viaDiameter)
  }
})
