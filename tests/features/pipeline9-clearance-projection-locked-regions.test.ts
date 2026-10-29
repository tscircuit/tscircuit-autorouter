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

test("local projection locks preloaded copper and points outside its repair region", (): void => {
  const routes: HighDensityRoute[] = [0, 0.7, 8, 8.7].map((x, index) => {
    const terminalX = x + (index % 2 === 0 ? -1 : 1)
    return {
      connectionName: `net_${index}`,
      traceThickness: 0.15,
      viaDiameter: 0.5,
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
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.05,
    minViaDiameter: 0.5,
    minViaPadDiameter: 0.5,
    minViaHoleDiameter: 0.3,
    minPadEdgeToPadEdgeClearance: 0.25,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    bounds: { minX: -3, minY: -3, maxX: 12, maxY: 3 },
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
  const original = structuredClone(routes)
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
    lockedConnectionNames: new Set(["net_0"]),
    movableRegions: [{ center: { x: 0, y: 0 }, radius: 2 }],
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
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(1)
  expect(output[0]).toEqual(original[0])
  expect(output[2]).toEqual(original[2])
  expect(output[3]).toEqual(original[3])
  const a = output[0]!.vias[0]!
  const b = output[1]!.vias[0]!
  expect(Math.hypot(a.x - b.x, a.y - b.y) - 0.5).toBeGreaterThanOrEqual(0.25)
  for (let index = 0; index < routes.length; index++) {
    expect(output[index]!.route[0]).toEqual(original[index]!.route[0])
    expect(output[index]!.route.at(-1)).toEqual(original[index]!.route.at(-1))
  }
  expect(routes).toEqual(original)
})
