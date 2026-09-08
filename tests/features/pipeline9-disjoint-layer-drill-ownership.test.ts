import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("joint repair retains drill ownership across disjoint copper layers", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "first",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "second",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 1, z: 2 },
        { x: 0.21, y: 0, z: 2 },
        { x: 0.21, y: 0, z: 3 },
        { x: 1, y: 1, z: 3 },
      ],
      vias: [{ x: 0.21, y: 0 }],
    },
  ]
  const layers = ["top", "inner1", "inner2", "bottom"]
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: routes.flatMap((route) =>
      [route.route[0]!, route.route.at(-1)!].map((point, index) => ({
        type: "rect" as const,
        center: { x: point.x, y: point.y },
        width: 0.2,
        height: 0.2,
        layers: [layers[point.z]!],
        connectedTo: [route.connectionName, `${route.connectionName}_${index}`],
        circuitJsonMetadata: {
          pcb_smtpad_id: `${route.connectionName}_pad_${index}`,
          pcb_port_id: `${route.connectionName}_${index}`,
        },
      })),
    ),
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
        (point, index) => ({
          x: point.x,
          y: point.y,
          layer: layers[point.z]!,
          pcb_port_id: `${route.connectionName}_${index}`,
        }),
      ),
    })),
  }
  const originalRoutes = structuredClone(routes)
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const evaluate = (
    hdRoutes: HighDensityRoute[],
  ): ReturnType<typeof evaluateRelaxedDrc> =>
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: srj.connections,
        originalConnections: srj.connections,
        hdRoutes,
        layerCount: srj.layerCount,
        obstacles: srj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap,
      }),
    })
  expect(evaluate(routes).errors).toHaveLength(1)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(evaluate(solver.getOutput()).errors).toHaveLength(0)
  for (const [index, output] of solver.getOutput().entries()) {
    expect(output.route[0]).toEqual(originalRoutes[index]!.route[0])
    expect(output.route.at(-1)).toEqual(originalRoutes[index]!.route.at(-1))
    expect(output.traceThickness).toBe(0.1)
    expect(output.viaDiameter).toBe(0.3)
  }
  expect(routes).toEqual(originalRoutes)
})
