import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type {
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"

type ForceFixture = {
  solverParams: ConstructorParameters<
    typeof Pipeline9HighDensityForceImproveSolver
  >[0]
  newConnections: SimpleRouteConnection[]
}

type BoardFixture = {
  inputSrj: SimpleRouteJson & {
    layerCount: number
    minViaHoleDiameter: number
  }
  preloadedConnections: SimpleRouteConnection[]
  preloadedTraces: SimplifiedPcbTrace[]
}

// Full native ButterStick input; the earlier data-byte copper remains fixed.
// https://github.com/butterstick-fpga/butterstick-hardware/blob/0694ddfa9824a07f0c6c6981186e45f80187659c/hardware/ButterStick_r1.0/ButterStick.kicad_pcb
test("ButterStick force improvement beside completed DDR data wires", async (): Promise<void> => {
  const forceFixtureUrl = new URL(
    "../fixtures/assets/butterstick-force-improvement.json.gz",
    import.meta.url,
  )
  const { solverParams, newConnections } = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(forceFixtureUrl))).toString("utf8"),
  ) as ForceFixture
  const boardFixtureUrl = new URL(
    "../fixtures/assets/butterstick-ddr-fixed-copper.srj.json.gz",
    import.meta.url,
  )
  const { inputSrj, preloadedConnections, preloadedTraces } = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(boardFixtureUrl))).toString("utf8"),
  ) as BoardFixture
  const solver = new Pipeline9HighDensityForceImproveSolver(solverParams)
  solver.solve()
  expect(solver.solved).toBeTrue()

  const srjWithPointPairs = {
    ...solverParams.inputSrj,
    connections: newConnections,
  }
  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: newConnections,
    originalConnections: inputSrj.connections,
    hdRoutes: solver.getOutput(),
    layerCount: inputSrj.layerCount,
    obstacles: solverParams.inputSrj.obstacles,
    defaultViaHoleDiameter: inputSrj.minViaHoleDiameter,
    connMap: getConnectivityMapFromSimpleRouteJson(srjWithPointPairs),
  })
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: {
        ...inputSrj,
        connections: [...preloadedConnections, ...inputSrj.connections],
        traces: preloadedTraces,
      },
      srjWithPointPairs: {
        ...srjWithPointPairs,
        connections: [...preloadedConnections, ...newConnections],
      },
      routedTraces,
      drcOptions: {
        traceClearance: inputSrj.minTraceToPadEdgeClearance,
        viaToPadClearance: getViaToPadClearance(inputSrj),
        viaClearance: inputSrj.minViaHoleEdgeToViaHoleEdgeClearance,
        holeClearance: inputSrj.minTraceToHoleEdgeClearance,
      },
    }),
  ).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
})
