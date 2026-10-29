import { expect, test } from "bun:test"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { issue3130Input } from "../fixtures/issue3130-via-pad-clearance"

test("Pipeline9 candidate evaluator identifies unsafe escape routes and accepts clean via copper", (): void => {
  const input = structuredClone(issue3130Input)
  const evaluate = createPipeline9RelaxedDrcEvaluator({
    connections: input.connections,
    originalConnections: input.connections,
    originalSrj: input,
    srjWithPointPairs: input,
    obstacles: input.obstacles,
    layerCount: input.layerCount,
    defaultViaHoleDiameter: 0.3,
    connMap: getConnectivityMapFromSimpleRouteJson(input),
    mutatedPreloadedTraces: [],
  })
  const routes: HighDensityRoute[] = [0.95, 0.97].map(
    (x, index): HighDensityRoute => {
      const y = index * 3
      return {
        connectionName: `escape_${index}`,
        rootConnectionName: `escape_${index}`,
        traceThickness: 0.1,
        viaDiameter: 0.6,
        route: [
          { x: 2, y, z: 0, pcb_port_id: `start_${index}` },
          { x, y, z: 0 },
          { x, y, z: 1 },
          { x: 2, y: y + 1, z: 1, pcb_port_id: `end_${index}` },
        ],
        vias: [{ x, y }],
      }
    },
  )
  const unsafe = evaluate({ traces: [], hdRoutes: routes })
  if (Array.isArray(unsafe)) {
    throw new Error("The Pipeline9 evaluator must include location metadata")
  }
  expect(unsafe.errors).toHaveLength(2)
  expect(unsafe.errorsWithCenters).toHaveLength(2)
  expect(unsafe.errors.map(getDrcErrorTraceIds)).toEqual([
    ["escape_0_0"],
    ["escape_1_0"],
  ])
  for (const error of unsafe.errors) {
    expect(error).toMatchObject({
      type: "pcb_pad_pad_clearance_error",
      minimum_clearance: 0.2,
    })
  }

  for (const route of routes) {
    const oldX = route.vias[0]!.x
    route.vias[0]!.x = 1.1
    for (const point of route.route) {
      if (point.x === oldX) point.x = 1.1
    }
  }
  const clean = evaluate({ traces: [], hdRoutes: routes })
  if (Array.isArray(clean)) {
    throw new Error("The Pipeline9 evaluator must include location metadata")
  }
  expect(clean.errors).toHaveLength(0)
})
