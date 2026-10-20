import { expect, test } from "bun:test"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { issue3130Input } from "./fixtures/issue3130-via-pad-clearance"

test("indexed repair scoring honors declared via-pad copper clearances", (): void => {
  const cases: Array<{
    rules: Partial<SimpleRouteJson>
    count: number
    minimum?: number
  }> = [
    { rules: {}, count: 2, minimum: 0.2 },
    {
      rules: { minViaEdgeToPadEdgeClearance: 0.1 },
      count: 2,
      minimum: 0.2,
    },
    {
      rules: { minViaEdgeToPadEdgeClearance: 0.25 },
      count: 2,
      minimum: 0.25,
    },
    { rules: { minPadEdgeToPadEdgeClearance: 0.16 }, count: 1, minimum: 0.16 },
    {
      rules: {
        minPadEdgeToPadEdgeClearance: 0,
        minViaEdgeToPadEdgeClearance: 0,
      },
      count: 0,
    },
    { rules: { minPadEdgeToPadEdgeClearance: undefined }, count: 0 },
  ]
  const routes: HighDensityRoute[] = [0.95, 0.97].map(
    (x, index): HighDensityRoute => ({
      connectionName: `escape_${index}`,
      rootConnectionName: `escape_${index}`,
      traceThickness: 0.1,
      viaDiameter: 0.6,
      route: [
        { x: 2, y: index * 3, z: 0, pcb_port_id: `start_${index}` },
        { x, y: index * 3, z: 0 },
        { x, y: index * 3, z: 1 },
        { x: 2, y: index * 3 + 1, z: 1, pcb_port_id: `end_${index}` },
      ],
      vias: [{ x, y: index * 3 }],
    }),
  )
  for (const { rules, count, minimum } of cases) {
    const input = { ...structuredClone(issue3130Input), ...rules }
    for (const [index, obstacle] of input.obstacles.entries()) {
      const padId = `pcb_smtpad_${index}`
      obstacle.connectedTo.push(padId)
      obstacle.circuitJsonMetadata = { pcb_smtpad_id: padId }
    }
    const evaluate = createPipeline7AutoroutingDrcEvaluator({
      connections: input.connections,
      originalConnections: input.connections,
      originalSrj: input,
      srjWithPointPairs: input,
      obstacles: input.obstacles,
      layerCount: input.layerCount,
      defaultViaHoleDiameter: 0.3,
      connMap: getConnectivityMapFromSimpleRouteJson(input),
    })
    const result = evaluate({ traces: [], routes })
    if (Array.isArray(result)) {
      throw new Error("Indexed evaluation must retain error locations")
    }
    expect(result.errors).toHaveLength(count)
    for (const error of result.errors) {
      expect(error).toMatchObject({
        type: "pcb_pad_pad_clearance_error",
        minimum_clearance: minimum,
      })
    }
  }
})
