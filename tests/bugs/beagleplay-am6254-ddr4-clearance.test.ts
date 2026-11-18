import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { checkEachPcbPortConnectedToPcbTraces } from "@tscircuit/checks"
import input from "../../fixtures/bug-reports/beagleplay-am6254-ddr4/input.srj.json"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getMinimumTraceGap } from "../fixtures/getMinimumTraceGap"

type Params = ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0]
type CapturedRepair = Pick<
  Params,
  "newConnections" | "newHdRoutes" | "originalNewHdRoutes"
> & {
  originalReportTracePair: SimplifiedPcbTrace[]
  baseTracePair: SimplifiedPcbTrace[]
}

test("BeaglePlay joint repair clears the reported DDR spacing violations", (): void => {
  const capture: CapturedRepair = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/beagleplay-am6254-ddr4-joint-repair.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const srj = structuredClone(input) as SimpleRouteJson
  const { newConnections, newHdRoutes, originalNewHdRoutes } = capture
  const pointPairs = { ...srj, connections: newConnections, traces: [] }
  const requiredClearance = srj.minTraceToPadEdgeClearance
  if (requiredClearance === undefined) {
    throw new Error("BeaglePlay requires a declared trace clearance")
  }
  const drcInput = {
    inputSrj: srj,
    srjWithPointPairs: pointPairs,
    includeBoardClearance: true,
    drcOptions: { traceClearance: requiredClearance },
  }

  // Check the captured failing routes on the same pad model as the repaired
  // board. These are the original report and the draft's current base.
  for (const [errorId, routedTraces] of [
    ["overlap_DDR_PARITY_0_DDR_A6_0", capture.originalReportTracePair],
    ["overlap_DDR_PARITY_0_DDR_A7_0", capture.baseTracePair],
  ] as const) {
    const before = evaluateRelaxedDrc({ ...drcInput, routedTraces })
    expect(before.errors).toContainEqual(
      expect.objectContaining({
        type: "pcb_trace_error",
        pcb_trace_error_id: errorId,
      }),
    )
  }

  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const { padDiameter, holeDiameter } = getViaDimensions(srj)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj: pointPairs,
    srjWithPointPairs: pointPairs,
    originalSrj: srj,
    newConnections,
    newHdRoutes,
    originalNewHdRoutes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: padDiameter,
    defaultViaHoleDiameter: holeDiameter,
    effort: 1,
    colorMap: {},
  })
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()

  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: newConnections,
    originalConnections: srj.connections,
    hdRoutes: canonicalizePipeline9HdRoutes(solver.getOutput()),
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: holeDiameter,
    connMap,
  })
  const routesByNet = new Map(
    routedTraces.map((trace) => [trace.connection_name, trace]),
  )
  expect(routedTraces).toHaveLength(51)
  expect([...routesByNet.keys()].sort()).toEqual(
    srj.connections.map((connection) => connection.name).sort(),
  )
  const parity = routesByNet.get("DDR_PARITY")!
  for (const name of ["DDR_A6", "DDR_A7"]) {
    const gap = getMinimumTraceGap(parity, routesByNet.get(name)!)
    expect(gap, `DDR_PARITY / ${name}`).toBeGreaterThanOrEqual(
      requiredClearance,
    )
  }

  const { circuitJson, errors } = evaluateRelaxedDrc({
    ...drcInput,
    routedTraces,
  })
  const ports = circuitJson.filter((element) => element.type === "pcb_port")
  expect(ports).toHaveLength(102)
  expect(checkEachPcbPortConnectedToPcbTraces(circuitJson)).toEqual([])
  expect(errors).toEqual([])
})
