import { expect, test } from "bun:test"
import { SpatialObstacleIndex } from "@tscircuit/power-trace-expander"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { SimpleRouteJson } from "lib/types"

test("power expansion honors general and via-specific pad rules without widening trace rules", (): void => {
  for (const rules of [
    { minPadEdgeToPadEdgeClearance: 0.15 },
    {
      minPadEdgeToPadEdgeClearance: 0.15,
      minViaEdgeToPadEdgeClearance: 0.1,
    },
    {
      minPadEdgeToPadEdgeClearance: 0.15,
      minViaEdgeToPadEdgeClearance: 0.25,
    },
    { minViaEdgeToPadEdgeClearance: 0.2 },
  ]) {
    const input: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.1,
      ...rules,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      connections: [],
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: 0 },
          width: 0.5,
          height: 0.5,
          layers: ["top"],
          connectedTo: ["pcb_smtpad_1", "PAD_NET"],
        },
      ],
    }
    const original = structuredClone(input)
    const solver = new PowerTraceExpansionSolver(input)
    const index = new SpatialObstacleIndex(
      solver.powerTraceExpanderSolver.inputProblem,
      [],
    )
    const required = Math.max(
      rules.minPadEdgeToPadEdgeClearance ?? 0,
      rules.minViaEdgeToPadEdgeClearance ?? 0,
    )
    const query = {
      point: { x: 0.25 + 0.15 + required - 0.01, y: 0 },
      layers: ["top", "bottom"],
      padDiameter: 0.3,
      holeDiameter: 0.15,
      connectionNames: ["VIA_NET"],
      obstacleClearance: 0.1,
    }
    expect(index.collidesVia(query)).toBeTrue()
    expect(
      index.collidesVia({
        ...query,
        point: { x: query.point.x + 0.02, y: 0 },
      }),
    ).toBeFalse()
    expect(
      index.collidesVia({ ...query, connectionNames: ["PAD_NET"] }),
    ).toBeFalse()
    expect(index.collidesVia({ ...query, layers: ["bottom"] })).toBeFalse()
    expect(
      index.collides({
        start: query.point,
        end: query.point,
        layer: "top",
        width: query.padDiameter,
        connectionNames: query.connectionNames,
        obstacleClearance: 0.1,
      }),
    ).toBeFalse()
    expect(input).toEqual(original)
  }
})
