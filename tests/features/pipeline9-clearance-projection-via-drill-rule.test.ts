import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("projection separates via copper enough to satisfy stricter drill-to-drill clearance", (): void => {
  const routes: HighDensityRoute[] = [0, 0.56].map((x, index) => {
    const terminalX = index === 0 ? -1 : 1.56
    return {
      connectionName: `net_${index}`,
      traceThickness: 0.1,
      viaDiameter: 0.45,
      route: [
        { x: terminalX, y: -1, z: 0, pcb_port_id: `net_${index}_start` },
        { x, y: 0, z: 0 },
        { x, y: 0, z: 1 },
        { x: terminalX, y: 1, z: 1, pcb_port_id: `net_${index}_end` },
      ],
      vias: [{ x, y: 0 }],
    }
  })
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.16,
    minViaDiameter: 0.45,
    minViaPadDiameter: 0.45,
    minViaHoleDiameter: 0.2,
    minPadEdgeToPadEdgeClearance: 0.1,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.4,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: routes.flatMap((route) =>
      [route.route[0]!, route.route.at(-1)!].map((point, index) => ({
        type: "rect" as const,
        center: { x: point.x, y: point.y },
        width: 0.4,
        height: 0.4,
        layers: [index === 0 ? "top" : "bottom"],
        connectedTo: [route.connectionName, point.pcb_port_id!],
        circuitJsonMetadata: {
          pcb_port_id: point.pcb_port_id,
          pcb_smtpad_id: `pad_${route.connectionName}_${index}`,
        },
      })),
    ),
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [
        { ...route.route[0]!, layer: "top" },
        { ...route.route.at(-1)!, layer: "bottom" },
      ],
    })),
  }
  const drcEvaluator: DrcEvaluator = ({
    routes: candidateRoutes,
  }): ReturnType<DrcEvaluator> => {
    if (!candidateRoutes) throw new Error("Expected projected HD routes")
    const json = convertToCircuitJson(input, candidateRoutes)
    json.push(createPcbBoardElement(input))
    return getDrcErrors(json, {
      traceClearance: input.minTraceToPadEdgeClearance,
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
    }) as unknown as ReturnType<DrcEvaluator>
  }
  const solver = new Pipeline9ClearanceProjectionSolver({
    originalSrj: input,
    routes,
    usePrecisionMargin: true,
    drcEvaluator,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const output = solver.getOutput()
  const validation = drcEvaluator({
    traces: [],
    routes: output,
    hdRoutes: output,
  })
  expect(Array.isArray(validation) ? validation : validation.errors).toEqual([])
  const viaA = output[0]!.vias[0]!
  const viaB = output[1]!.vias[0]!
  expect(
    Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y) - 0.2,
  ).toBeGreaterThanOrEqual(0.4)
})
