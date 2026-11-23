import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { createHdRoutesToSimplifiedPcbTracesConverter } from "lib/utils/convertHdRoutesToSimplifiedPcbTraces"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Glider projection priority", async (): Promise<void> => {
  // Three native DDR routes and two earlier inner-layer wires, with original rules.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/glider-projection-priority.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as {
    srj: SimpleRouteJson
    connections: SimpleRouteJson["connections"]
    routes: HighDensityRoute[]
  }
  const original = structuredClone(fixture)
  const { srj, connections, routes } = fixture
  const srjWithPointPairs = { ...srj, connections }
  const connMap = getConnectivityMapFromSimpleRouteJson({
    ...srj,
    connections: [...srj.connections, ...connections],
  })
  const convert = createHdRoutesToSimplifiedPcbTracesConverter({
    connections,
    originalConnections: srj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: srj.minViaHoleDiameter!,
    connMap,
  })
  const drcOptions = {
    traceClearance: 0.11,
    viaToPadClearance: 0.11,
    viaClearance: srj.minViaHoleEdgeToViaHoleEdgeClearance,
  }
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: srj,
    srjWithPointPairs,
    includeBoardClearance: true,
    drcOptions,
  })
  const initialErrors = evaluate(convert(routes)).errors
  expect(
    initialErrors.filter(
      (error): boolean => error.drc_source !== "fixed_copper",
    ),
  ).toHaveLength(1)
  expect(
    initialErrors.filter(
      (error): boolean => error.drc_source === "fixed_copper",
    ),
  ).toHaveLength(4)
  const joint = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs,
    originalSrj: srj,
    newConnections: connections,
    newHdRoutes: routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set<string>(),
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: srj.minViaDiameter!,
    defaultViaHoleDiameter: srj.minViaHoleDiameter!,
    effort: 1,
    colorMap: {},
    connMap,
  })
  joint.solve()
  expect(joint.failed).toBe(false)
  expect(joint.solved).toBe(true)
  expect(joint.stats.initialBoundedRegionalRepairAccepted).toBe(true)
  expect(evaluate(convert(joint.getOutput())).errors).toEqual([])
  expect(fixture).toEqual(original)
  const firstPass = joint.initialBoundedRegionalRepairSolver!
  const routedTraces = convert(firstPass.getResult().routes)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: srj,
      srjWithPointPairs,
      routedTraces,
      drcOptions,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
