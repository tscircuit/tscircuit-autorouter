import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimplifiedPcbTrace } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import {
  preloadedFanoutBusLengthHdRoutes,
  preloadedFanoutBusLengthInput,
} from "../fixtures/preloaded-fanout-bus-length"

const getPlanarTraceLength = (trace: SimplifiedPcbTrace): number => {
  let length = 0
  for (let index = 1; index < trace.route.length; index++) {
    const previous = trace.route[index - 1]!
    const point = trace.route[index]!
    if (!("x" in previous) || !("x" in point)) {
      throw new Error(
        "Expected wire/via geometry in the reduced fanout fixture",
      )
    }
    length += Math.hypot(point.x - previous.x, point.y - previous.y)
  }
  return length
}

test(
  "bus matching includes retained CPU-to-escape copper",
  async (): Promise<void> => {
    const input = structuredClone(preloadedFanoutBusLengthInput)
    const original = structuredClone(input)
    const hdRoutes = structuredClone(preloadedFanoutBusLengthHdRoutes)
    const solver = new LengthMatchingPostProcessingSolver({
      hdRoutes,
      differentialPairs: [],
      buses: input.buses!,
      connections: input.connections,
      traces: input.traces,
      obstacles: input.obstacles,
      bounds: input.bounds,
      layerCount: input.layerCount,
      obstacleMargin: 0.1,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(input).toEqual(original)

    const routes = solver.getOutput().hdRoutes
    const routedTraces: SimplifiedPcbTrace[] = routes.map((route) => ({
      type: "pcb_trace",
      pcb_trace_id: `${route.connectionName}_carrier`,
      connection_name: route.rootConnectionName ?? route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, input.layerCount),
    }))
    const fullTraces = [...input.traces!, ...routedTraces]
    const lengths = ["A", "B"].map((connectionName) =>
      fullTraces
        .filter((trace) => trace.connection_name === connectionName)
        .reduce((total, trace) => total + getPlanarTraceLength(trace), 0),
    )
    const skew = Math.abs(lengths[0]! - lengths[1]!)
    const errors = evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: input,
      routedTraces,
    }).errors
    expect(errors).toHaveLength(0)
    const graphics: GraphicsObject = convertSrjToGraphicsObject({
      ...input,
      traces: fullTraces,
    })
    graphics.texts = [
      ...(graphics.texts ?? []),
      {
        x: -10,
        y: 7,
        text: `CPU-to-DDR A: ${lengths[0]!.toFixed(3)}mm; B: ${lengths[1]!.toFixed(3)}mm`,
        fontSize: 0.65,
        anchorSide: "center_left",
        color: "black",
      },
      {
        x: -10,
        y: 6,
        text: `Full-path skew: ${skew.toFixed(3)}mm; limit: 0.100mm; relaxed DRC errors: ${errors.length}`,
        fontSize: 0.65,
        anchorSide: "center_left",
        color: skew <= 0.1 + 1e-6 ? "green" : "red",
      },
    ]
    await expect(
      getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
    ).toMatchSvgSnapshot(import.meta.path)

    const a = routes.find((route) => route.connectionName === "A")!
    const b = routes.find((route) => route.connectionName === "B")!
    expect(a.route[0]).toMatchObject({ x: -4, y: 0, z: 0 })
    expect(a.route.at(-1)).toMatchObject({ x: 5, y: 0, z: 0 })
    expect(b.route[0]).toMatchObject({ x: -5, y: 3, z: 0 })
    expect(b.route.at(-1)).toMatchObject({ x: 5, y: 3, z: 0 })
    expect(skew).toBeLessThanOrEqual(0.1 + 1e-6)
  },
)
