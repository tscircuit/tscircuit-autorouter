import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getA13ViaCleanupSnapshotSvg } from "tests/fixtures/getA13ViaCleanupSnapshotSvg"

type JointRepairParams = ConstructorParameters<
  typeof Pipeline9JointDrcRepairSolver
>[0]
type A13JointRepairFixture = Omit<
  JointRepairParams,
  "connMap" | "mutatedPreloadedTraceIds"
> & {
  netMap: Record<string, string[]>
  mutatedPreloadedTraceIds: string[]
}

test("preserves native A13 trace clearance while removing repaired vias", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/a13-joint-via-cleanup.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as A13JointRepairFixture
  const originalFixture = structuredClone(fixture)
  const { netMap, mutatedPreloadedTraceIds, ...params } = fixture
  const connMap = new ConnectivityMap(structuredClone(netMap))
  const solver = new Pipeline9JointDrcRepairSolver({
    ...params,
    connMap,
    mutatedPreloadedTraceIds: new Set(mutatedPreloadedTraceIds),
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(fixture).toEqual(originalFixture)
  const routes = solver.getOutput()
  expect(new Set(routes.map((route) => route.connectionName))).toEqual(
    new Set(params.newHdRoutes.map((route) => route.connectionName)),
  )
  const convertNewRoutes =
    createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
      connections: params.newConnections,
      originalConnections: params.originalSrj.connections,
      layerCount: params.layerCount,
      obstacles: params.obstacles,
      defaultViaHoleDiameter: params.defaultViaHoleDiameter,
      connMap,
    })
  const snapshotInput = {
    inputSrj: params.originalSrj,
    srjWithPointPairs: params.srjWithPointPairs,
    routedTraces: [
      ...convertNewRoutes(routes),
      ...solver.getUpdatedPreloadedTraces(),
    ],
    drcOptions: {
      traceClearance: params.originalSrj.minTraceToPadEdgeClearance,
      viaToPadClearance: params.originalSrj.minViaEdgeToPadEdgeClearance,
    },
  }
  const { errors } = evaluateRelaxedDrc(snapshotInput)
  expect(errors).toHaveLength(9)
  const view = { input: snapshotInput, errorCount: errors.length }
  await expect(getA13ViaCleanupSnapshotSvg(view)).toMatchSvgSnapshot(
    import.meta.path,
  )
  await expect(
    getA13ViaCleanupSnapshotSvg({ ...view, focused: true }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "detail" })
})
