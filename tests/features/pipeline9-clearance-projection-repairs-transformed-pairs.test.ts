import { checkViaTraceClearance } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9ClearanceProjection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("clearance projection repairs translated and rotated sets of nine physical pairs", (): void => {
  for (const [quarterTurns, clearance] of [[0, 0.1], [1, 0.15], [2, 0.2]] as const) {
    const transform = (x: number, y: number): { x: number; y: number } => {
      let rotatedX = x
      let rotatedY = y
      for (let turn = 0; turn < quarterTurns; turn++) {
        const previousX = rotatedX
        rotatedX = -rotatedY
        rotatedY = previousX
      }
      return { x: rotatedX + 7, y: rotatedY - 9 }
    }
    const routes: HighDensityRoute[] = []
    for (let index = 0; index < 9; index++) {
      const x = (index % 3) * 4
      const y = Math.floor(index / 3) * 4
      routes.push({
        connectionName: `owner_${quarterTurns}_${index}`,
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { ...transform(x - 1, y), z: 0 },
          { ...transform(x, y), z: 0 },
          { ...transform(x, y), z: 1 },
          { ...transform(x + 1, y), z: 1 },
        ],
        vias: [transform(x, y)],
      })
      routes.push({
        connectionName: `signal_${quarterTurns}_${index}`,
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [-1, -0.5, 0.5, 1].map((dx) => ({
          ...transform(x + dx, y + clearance + 0.189),
          z: 0,
        })),
        vias: [],
      })
    }
    const srj: SimpleRouteJson = {
      bounds: { minX: -20, minY: -25, maxX: 20, maxY: 10 },
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      minTraceToPadEdgeClearance: clearance,
      obstacles: routes.flatMap((route) =>
        [route.route[0]!, route.route.at(-1)!].map((point, endpoint) => ({
          type: "rect",
          obstacleId: `${route.connectionName}_pad_${endpoint}`,
          center: { x: point.x, y: point.y },
          width: 0.15,
          height: 0.15,
          layers: [point.z === 0 ? "top" : "bottom"],
          connectedTo: [
            route.connectionName,
            `${route.connectionName}_port_${endpoint}`,
          ],
        })),
      ),
      connections: routes.map((route) => ({
        name: route.connectionName,
        pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
          (point, endpoint) => ({
            x: point.x,
            y: point.y,
            layer: point.z === 0 ? "top" : "bottom",
            pcb_port_id: `${route.connectionName}_port_${endpoint}`,
          }),
        ),
      })),
    }
    const originalRoutes = structuredClone(routes)
    const evaluate = (
      candidate: HighDensityRoute[],
    ): ReturnType<typeof evaluateRelaxedDrc> => {
      const traces: SimplifiedPcbTrace[] = candidate.map((route) => ({
        type: "pcb_trace",
        pcb_trace_id: `${route.connectionName}_0`,
        connection_name: route.connectionName,
        route: convertHdRouteToSimplifiedRoute(route, 2),
      }))
      return evaluateRelaxedDrc({
        inputSrj: srj,
        srjWithPointPairs: srj,
        routedTraces: traces,
        drcOptions: { traceClearance: clearance },
      })
    }
    const drcEvaluator: DrcEvaluator = ({ routes: candidate, hdRoutes }) => {
      const evaluatedRoutes = candidate ?? hdRoutes
      if (!evaluatedRoutes) throw new Error("Missing candidate routes")
      const result = evaluate(evaluatedRoutes)
      const viaOwners = new Map(
        result.circuitJson
          .filter((element) => element.type === "pcb_via")
          .map((via) => [via.pcb_via_id, via.pcb_trace_id]),
      )
      const errors: Pipeline9DrcError[] = result.errorsWithCenters.map(
        (error) => {
          if (error.type !== "pcb_via_trace_clearance_error") {
            return { ...error }
          }
          const owner = viaOwners.get(error.pcb_via_id)
          if (!owner) throw new Error("Missing physical via owner")
          return {
            ...error,
            pcb_trace_ids: [error.pcb_trace_id, owner],
            pcb_via_ids: [error.pcb_via_id],
          }
        },
      )
      return { errors, errorsWithCenters: errors }
    }
    const initial = drcEvaluator({ traces: [], routes })
    if (Array.isArray(initial)) throw new Error("Missing centered DRC result")
    expect(initial.errors).toHaveLength(9)
    const result = applyPipeline9ClearanceProjection({
      originalSrj: srj,
      routes,
      syntheticConnectionNames: new Set(),
      drcEvaluator,
    })
    expect(result).not.toBe(routes)
    expect(routes).toEqual(originalRoutes)
    const final = evaluate(result)
    expect(final.errors).toHaveLength(0)
    const physicalGaps = checkViaTraceClearance(final.circuitJson, {
      minClearance: clearance + 0.1,
    })
    expect(physicalGaps).toHaveLength(9)
    for (const gap of physicalGaps) {
      expect(gap.actual_clearance).toBeGreaterThanOrEqual(clearance - 1e-9)
    }
    for (let index = 0; index < routes.length; index++) {
      expect(result[index]!.route[0]).toEqual(routes[index]!.route[0])
      expect(result[index]!.route.at(-1)).toEqual(
        routes[index]!.route.at(-1),
      )
      expect(result[index]!.traceThickness).toBe(
        routes[index]!.traceThickness,
      )
      expect(result[index]!.viaDiameter).toBe(routes[index]!.viaDiameter)
    }
  }
})
