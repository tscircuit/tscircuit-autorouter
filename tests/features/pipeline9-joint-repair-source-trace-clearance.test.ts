import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

type ClearanceCase = {
  defaultObstacleMargin: number
  minTraceToPadEdgeClearance?: number
  initialGap: number
  requiredGap: number
  unchanged?: boolean
}

const getCopperGap = (routes: HighDensityRoute[]): number => {
  const [left, right] = routes
  let gap = Number.POSITIVE_INFINITY
  for (let i = 1; i < left!.route.length; i++) {
    for (let j = 1; j < right!.route.length; j++) {
      gap = Math.min(
        gap,
        minimumDistanceBetweenSegments(
          left!.route[i - 1]!,
          left!.route[i]!,
          right!.route[j - 1]!,
          right!.route[j]!,
        ) -
          (left!.traceThickness + right!.traceThickness) / 2,
      )
    }
  }
  return gap
}

test("joint repair honors a source trace margin without lowering the relaxed floor or overriding an explicit clearance", (): void => {
  const cases: ClearanceCase[] = [
    {
      defaultObstacleMargin: 0.10668,
      initialGap: 0.10164901465087509,
      requiredGap: 0.10668,
    },
    { defaultObstacleMargin: 0.05, initialGap: 0.075, requiredGap: 0.1 },
    {
      defaultObstacleMargin: 0.2,
      minTraceToPadEdgeClearance: 0.05,
      initialGap: 0.075,
      requiredGap: 0.05,
      unchanged: true,
    },
  ]
  for (const scenario of cases) {
    const width = 0.1066
    // The V approaches a separate straight wire. Its closest corner has the
    // positive but insufficient copper gap observed in the A64 regression.
    const routes: HighDensityRoute[] = [
      {
        connectionName: "straight",
        rootConnectionName: "straight",
        traceThickness: width,
        viaDiameter: 0.327,
        vias: [],
        route: [
          { x: -2, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
        ],
      },
      {
        connectionName: "approach",
        rootConnectionName: "approach",
        traceThickness: width,
        viaDiameter: 0.327,
        vias: [],
        route: [
          { x: -2, y: 1, z: 0 },
          { x: 0, y: width + scenario.initialGap, z: 0 },
          { x: 2, y: 1, z: 0 },
        ],
      },
    ]
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: width,
      minViaPadDiameter: 0.327,
      minViaHoleDiameter: 0.2,
      defaultObstacleMargin: scenario.defaultObstacleMargin,
      ...(scenario.minTraceToPadEdgeClearance === undefined
        ? {}
        : { minTraceToPadEdgeClearance: scenario.minTraceToPadEdgeClearance }),
      bounds: { minX: -3, maxX: 3, minY: -1, maxY: 2 },
      obstacles: [],
      connections: routes.map((route) => ({
        name: route.connectionName,
        pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
          (point, index) => ({
            x: point.x,
            y: point.y,
            layer: "top",
            pointId: `${route.connectionName}_${index}`,
            pcb_port_id: `${route.connectionName}_${index}`,
          }),
        ),
      })),
    }
    for (const [index, route] of routes.entries()) {
      route.route[0]!.pcb_port_id =
        srj.connections[index]!.pointsToConnect[0]!.pcb_port_id
      route.route.at(-1)!.pcb_port_id =
        srj.connections[index]!.pointsToConnect[1]!.pcb_port_id
    }
    const originalRoutes = structuredClone(routes)
    const originalSrj = structuredClone(srj)
    const connMap = getConnectivityMapFromSimpleRouteJson(srj)
    const convert = (hdRoutes: HighDensityRoute[]): SimplifiedPcbTraces =>
      convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: srj.connections,
        originalConnections: srj.connections,
        hdRoutes,
        layerCount: 2,
        obstacles: srj.obstacles,
        defaultViaHoleDiameter: 0.2,
        connMap,
      })
    const before = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: convert(routes),
      drcOptions: { traceClearance: scenario.requiredGap },
    })
    expect(getCopperGap(routes)).toBeCloseTo(scenario.initialGap, 12)
    if (scenario.unchanged) expect(before.errors).toHaveLength(0)
    else
      expect(
        before.errors.some((error) => error.type === "pcb_trace_error"),
      ).toBeTrue()

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
      layerCount: 2,
      defaultViaDiameter: 0.327,
      defaultViaHoleDiameter: 0.2,
      effort: 1,
      colorMap: {},
    })
    solver.solve()
    expect(solver.failed, solver.error ?? "").toBeFalse()
    expect(solver.solved).toBeTrue()
    const output = solver.getOutput()
    expect(output).toHaveLength(2)
    for (const [index, route] of output.entries()) {
      const original = originalRoutes[index]!
      expect(route.connectionName).toBe(original.connectionName)
      expect(route.rootConnectionName).toBe(original.rootConnectionName)
      expect(route.route[0]).toEqual(original.route[0])
      expect(route.route.at(-1)).toEqual(original.route.at(-1))
      expect(route.route.length).toBeGreaterThanOrEqual(2)
      expect(
        route.route.every(
          (point) =>
            point.z === 0 &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y),
        ),
      ).toBeTrue()
      expect(route.traceThickness).toBe(width)
      expect(
        route.route.every(
          (point) =>
            point.traceThickness === undefined ||
            point.traceThickness === width,
        ),
      ).toBeTrue()
      expect(route.vias).toEqual([])
    }
    expect(getCopperGap(output)).toBeGreaterThanOrEqual(
      scenario.requiredGap - 1e-7,
    )
    const traces = convert(output)
    expect(traces).toHaveLength(2)
    for (const [index, trace] of traces.entries()) {
      expect(trace.connectsTo).toEqual(
        srj.connections[index]!.pointsToConnect.map((point) => point.pointId!),
      )
      expect(
        trace.route.every(
          (point) =>
            point.route_type === "wire" &&
            point.layer === "top" &&
            point.width === width,
        ),
      ).toBeTrue()
    }
    expect(
      evaluateRelaxedDrc({
        inputSrj: srj,
        srjWithPointPairs: srj,
        routedTraces: traces,
        drcOptions: { traceClearance: scenario.requiredGap },
      }).errors,
    ).toHaveLength(0)
    if (scenario.unchanged) expect(output).toEqual(originalRoutes)
    expect(routes).toEqual(originalRoutes)
    expect(srj).toEqual(originalSrj)
  }
})
