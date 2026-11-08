import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { createDrcConnectivityMap } from "lib/utils/createDrcConnectivityMap"
import { getSameNetCopperGapBridges } from "lib/utils/getSameNetCopperGapBridges"
import { createSameNetCopperGapTestCase } from "tests/fixtures/createSameNetCopperGapTestCase"

test("same-net gap repair rejects a bridge that violates nearby foreign copper clearance", (): void => {
  const { srj, traces } = createSameNetCopperGapTestCase()
  // The two original round ends have 0.104 mm clearance to this trace. Filling
  // their slit would reduce that to 0.090 mm, so repair must fail explicitly.
  traces.push({
    type: "pcb_trace",
    pcb_trace_id: "foreign",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: 0.075, y: 0.19, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.075, y: 0.5, width: 0.1, layer: "top" },
    ],
  })
  srj.connections.push({
    name: "signal",
    pointsToConnect: [
      { x: 0.075, y: 0.19, layer: "top" },
      { x: 0.075, y: 0.5, layer: "top" },
    ],
  })
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: srj,
    srjWithPointPairs: srj,
    drcOptions: { traceClearance: 0.1, includeTraceContinuity: false },
  })
  const before = evaluate(traces)
  expect(before.errors).toHaveLength(0)
  const original = JSON.stringify(traces)
  expect(() =>
    getSameNetCopperGapBridges({
      circuitJson: before.circuitJson,
      traces,
      connMap: createDrcConnectivityMap(before.circuitJson),
      minimumClearance: 0.1,
      traceWidth: 0.1,
      validate: (bridges) => {
        expect(evaluate([...traces, ...bridges]).errors.length).toBeGreaterThan(
          0,
        )
        throw new Error("Bridge violates physical clearance")
      },
    }),
  ).toThrow("Bridge violates physical clearance")
  expect(JSON.stringify(traces)).toBe(original)
})
