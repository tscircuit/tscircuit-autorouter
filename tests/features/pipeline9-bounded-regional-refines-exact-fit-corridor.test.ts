import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
} from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { CLEARANCE_PRECISION_MARGIN } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearancePrecisionRepairs"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("nominal projection clears an exact-fit corridor after margin projection cannot", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -0.6, y: -0.04, z: 0, pcb_port_id: "left" },
        { x: -0.27, y: -0.006, z: 0 },
        { x: 0.24, y: -0.003, z: 0 },
        { x: 0.36, y: -0.004, z: 0, pcb_port_id: "right" },
      ],
    },
  ]
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [
      ...routes[0]!.route
        .filter((point) => point.pcb_port_id)
        .map((point) => ({
          type: "rect" as const,
          center: { x: point.x, y: point.y },
          width: 0.1,
          height: 0.1,
          layers: ["top"],
          connectedTo: ["signal", point.pcb_port_id!],
          circuitJsonMetadata: {
            pcb_smtpad_id: `${point.pcb_port_id}_pad`,
            pcb_port_id: point.pcb_port_id,
          },
        })),
      ...[-0.25, 0.25].map((y, index) => ({
        type: "rect" as const,
        center: { x: 0, y },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: [`foreign_${index}`],
        circuitJsonMetadata: { pcb_smtpad_id: `foreign_${index}` },
      })),
    ],
    connections: [
      {
        name: "signal",
        pointsToConnect: routes[0]!.route
          .filter((point) => point.pcb_port_id)
          .map((point) => ({
            x: point.x,
            y: point.y,
            layer: "top",
            pointId: point.pcb_port_id,
            pcb_port_id: point.pcb_port_id,
          })),
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const drcEvaluator: DrcEvaluator = ({
    routes: candidate,
    hdRoutes,
  }): ReturnType<DrcEvaluator> => {
    const evaluatedRoutes = candidate ?? hdRoutes
    if (!evaluatedRoutes) throw new Error("Missing candidate geometry")
    return evaluateRelaxedDrc({
      inputSrj: originalSrj,
      srjWithPointPairs: originalSrj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: originalSrj.connections,
        originalConnections: originalSrj.connections,
        hdRoutes: evaluatedRoutes,
        layerCount: originalSrj.layerCount,
        obstacles: originalSrj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap,
      }),
    }) as unknown as ReturnType<DrcEvaluator>
  }
  const original = structuredClone(routes)
  const gap = 0.5 - 0.2
  expect(gap).toBeCloseTo(routes[0]!.traceThickness + 2 * 0.1)
  expect(gap).toBeLessThan(
    routes[0]!.traceThickness + 2 * (0.1 + CLEARANCE_PRECISION_MARGIN),
  )
  const initial = drcEvaluator({ traces: [], routes })
  const initialErrors = Array.isArray(initial) ? initial : initial.errors
  expect(initialErrors).toHaveLength(1)
  expect(initialErrors[0]!.type).toBe("pcb_pad_trace_clearance_error")
  expect(initialErrors[0]!.actual_clearance).toBeLessThan(0.1)

  const margin = new Pipeline9ClearanceProjectionSolver({
    originalSrj,
    routes,
    previousRoutes: routes,
    drcEvaluator,
    usePrecisionMargin: true,
  })
  while (!margin.solved && !margin.failed) margin.step()
  expect(margin.error).toBeNull()
  expect(margin.failed).toBeFalse()
  expect(margin.solved).toBeTrue()
  const marginRoutes = margin.getOutput()
  const afterMargin = drcEvaluator({ traces: [], routes: marginRoutes })
  expect(
    Array.isArray(afterMargin) ? afterMargin : afterMargin.errors,
  ).toHaveLength(1)

  // Keep the same vertices and physical baseline when relaxing the extra margin.
  const nominal = new Pipeline9ClearanceProjectionSolver({
    originalSrj,
    routes: marginRoutes,
    previousRoutes: routes,
    drcEvaluator,
  })
  while (!nominal.solved && !nominal.failed) nominal.step()
  expect(nominal.error).toBeNull()
  expect(nominal.failed).toBeFalse()
  expect(nominal.solved).toBeTrue()
  const result = nominal.getOutput()
  const afterNominal = drcEvaluator({ traces: [], routes: result })
  expect(
    Array.isArray(afterNominal) ? afterNominal : afterNominal.errors,
  ).toHaveLength(0)
  expect(result).not.toBe(routes)
  expect(result).toHaveLength(routes.length)
  expect(result[0]!.route).toHaveLength(routes[0]!.route.length)
  expect(result[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(result[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(result[0]!.traceThickness).toBe(original[0]!.traceThickness)
  expect(result[0]!.viaDiameter).toBe(original[0]!.viaDiameter)
  expect(result[0]!.vias).toEqual(original[0]!.vias)
  expect(routes).toEqual(original)
  expect(
    getFixedObstacleViolations({
      srj: { ...originalSrj, traces: undefined },
      routes: result,
    }),
  ).toHaveLength(0)
  expect(
    getNewViaPadViolations({
      srj: { ...originalSrj, traces: undefined },
      previousRoutes: routes,
      routes: result,
    }),
  ).toHaveLength(0)
})
