import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type RepairInput = Omit<
  ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0],
  "connMap" | "mutatedPreloadedTraceIds"
>

test("repairs the real iCEPi DDR board beside circular BGA pads", async (): Promise<void> => {
  const captureUrl = new URL(
    "../fixtures/assets/icepi-circular-clearance/repair-input.json.gz",
    import.meta.url,
  )
  const capture: RepairInput = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(captureUrl))).toString("utf8"),
  )
  const referenceUrl = new URL(
    "../fixtures/assets/icepi-retained-vias/input.srj.json.gz",
    import.meta.url,
  )
  const { referenceSrj }: { referenceSrj: SimpleRouteJson } = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(referenceUrl))).toString("utf8"),
  )
  const connMap = getConnectivityMapFromSimpleRouteJson(capture.srj)
  const solver = new Pipeline9JointDrcRepairSolver({
    ...capture,
    connMap,
    mutatedPreloadedTraceIds: new Set(),
  })
  solver.solve()
  expect(solver.solved).toBeTrue()

  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: capture.newConnections,
    originalConnections: capture.originalSrj.connections,
    hdRoutes: solver.getOutput(),
    layerCount: capture.layerCount,
    obstacles: capture.obstacles,
    defaultViaHoleDiameter: capture.defaultViaHoleDiameter,
    connMap,
  })
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: referenceSrj,
      srjWithPointPairs: referenceSrj,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
