import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"

test("A64 native DDR stitching", async (): Promise<void> => {
  const { inputSrj, stitchInput }: {
    inputSrj: SimpleRouteJson
    stitchInput: ConstructorParameters<
      typeof MultipleHighDensityRouteStitchSolver3
    >[0]
  } = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/a64-native-stitch/input.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new MultipleHighDensityRouteStitchSolver3(stitchInput)
  solver.solve()
  expect(solver.solved).toBeTrue()

  const srjWithPointPairs = {
    ...inputSrj,
    connections: stitchInput.connections,
  }
  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: stitchInput.connections,
    originalConnections: inputSrj.connections,
    hdRoutes: canonicalizePipeline9HdRoutes(solver.mergedHdRoutes),
    layerCount: inputSrj.layerCount,
    obstacles: inputSrj.obstacles,
    defaultViaHoleDiameter: getViaDimensions(inputSrj).holeDiameter,
    connMap: getConnectivityMapFromSimpleRouteJson(srjWithPointPairs),
  })
  await expect(
    getBugReportSnapshotSvg({
      inputSrj,
      srjWithPointPairs,
      routedTraces,
      drcOptions: {
        traceClearance: inputSrj.minTraceToPadEdgeClearance,
        viaToPadClearance: inputSrj.minViaEdgeToPadEdgeClearance,
      },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
