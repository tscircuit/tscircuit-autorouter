import { pointToSegmentDistance } from "@tscircuit/math-utils"
import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
} from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { ClearanceProjectionSolver } from "lib/solvers/ClearanceProjectionSolver/ClearanceProjectionSolver"
import { createsTraceCrossing } from "lib/solvers/ClearanceProjectionSolver/createsTraceCrossing"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("coupled projection opens a via gap without moving fixed copper or crossing wires", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "via",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: -1.65, y: 0 }],
      route: [
        { x: -1.65, y: -1, z: 0 },
        { x: -1.65, y: 0, z: 0 },
        { x: -1.65, y: 0, z: 1 },
        { x: -1.2, y: 1, z: 1 },
      ],
    },
    {
      connectionName: "wire",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [-1.5, -0.5, 0.5, 1.5].map((y) => ({
        x: -1.37,
        y,
        z: 0,
      })),
    },
  ]
  const fixedRoute: HighDensityRoute = {
    connectionName: "fixed",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1.2, y: -1.5, z: 1 },
      { x: -1.2, y: -0.5, z: 1 },
      { x: 0, y: -0.5, z: 1 },
    ],
  }
  const asTrace = (route: HighDensityRoute): SimplifiedPcbTrace => ({
    type: "pcb_trace",
    pcb_trace_id: `${route.connectionName}_0`,
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, 2),
  })
  const geometry = [...routes, fixedRoute]
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    minBoardEdgeClearance: 0.2,
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    traces: [asTrace(fixedRoute)],
    obstacles: geometry.flatMap((route) =>
      [route.route[0]!, route.route.at(-1)!].map((point, index) => ({
        type: "rect",
        obstacleId: `${route.connectionName}_${index}`,
        center: { x: point.x, y: point.y },
        width: 0.15,
        height: 0.15,
        layers: [point.z === 0 ? "top" : "bottom"],
        connectedTo: [
          route.connectionName,
          `${route.connectionName}_port_${index}`,
        ],
      })),
    ),
    connections: geometry.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
        (point, index) => ({
          x: point.x,
          y: point.y,
          layer: point.z === 0 ? "top" : "bottom",
          pcb_port_id: `${route.connectionName}_port_${index}`,
        }),
      ),
    })),
  }
  const original = structuredClone({ srj, routes, fixedRoute })
  const drcEvaluator: DrcEvaluator = ({
    routes: candidate,
  }): ReturnType<DrcEvaluator> => {
    if (!candidate) throw new Error("Missing projection routes")
    const result = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: candidate.map(asTrace),
    })
    return { errors: result.errors.map((error) => ({ ...error })) }
  }
  const solver = new ClearanceProjectionSolver({
    originalSrj: srj,
    routes,
    fixedObstacleRoutes: [fixedRoute],
    colorMap: {},
    drcEvaluator,
  })
  solver.solve()
  const result = solver.getOutput()
  expect(solver.solved).toBe(true)
  expect(solver.stats.initialDrcIssueCount).toBe(1)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.stats.clearanceProjectionAccepted).toBe(true)
  expect(result).toHaveLength(routes.length)
  const via = result[0]!.route[1]!
  expect(via.x - srj.bounds.minX - 0.15).toBeGreaterThanOrEqual(0.2 - 1e-9)
  expect(
    pointToSegmentDistance(via, result[1]!.route[1]!, result[1]!.route[2]!) -
      0.2,
  ).toBeGreaterThanOrEqual(0.1 - 1e-6)
  expect(result[0]!.route[2]).toEqual({ ...via, z: 1 })
  const projectedGeometry = [...result, fixedRoute]
  expect(createsTraceCrossing(geometry, projectedGeometry)).toBe(false)
  expect(
    getFixedObstacleViolations({
      srj: { ...srj, traces: undefined },
      routes: projectedGeometry,
    }),
  ).toEqual([])
  expect(
    getNewViaPadViolations({
      srj: { ...srj, traces: undefined },
      previousRoutes: geometry,
      routes: projectedGeometry,
    }),
  ).toEqual([])
  for (const [index, route] of result.entries()) {
    expect(route.route[0]).toEqual(routes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(routes[index]!.route.at(-1))
    expect(route.traceThickness).toBe(routes[index]!.traceThickness)
    expect(route.viaDiameter).toBe(routes[index]!.viaDiameter)
  }
  expect({ srj, routes, fixedRoute }).toEqual(original)
})
