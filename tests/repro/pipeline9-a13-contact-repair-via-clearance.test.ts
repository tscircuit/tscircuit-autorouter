import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { isViaPadClearanceError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isViaPadClearanceError"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRoutesToSimplifiedPcbTraces } from "lib/utils/convertHdRoutesToSimplifiedPcbTraces"
import { createPcbBoardElement } from "lib/utils/convertToCircuitJson"

type JointRepairFixture = {
  srj: SimpleRouteJson
  originalSrj: SimpleRouteJson
  newConnections: SimpleRouteConnection[]
  newHdRoutes: HighDensityRoute[]
  originalNewHdRoutes: HighDensityRoute[]
  updatedPreloadedTraces: SimplifiedPcbTrace[]
  mutatedPreloadedTraceIds: string[]
  netMap: ConstructorParameters<typeof ConnectivityMap>[0]
  obstacles: SimpleRouteJson["obstacles"]
  layerCount: number
  defaultViaDiameter: number
  defaultViaHoleDiameter: number
  effort: number
}

// The RAM balls around the via the contact repair adds to source_net_77.
const FRAME = { centerX: -6.69, centerY: -1.74, size: 1.6 }

const renderFrame = (
  circuitJson: AnyCircuitElement[],
  srj: SimpleRouteJson,
): string =>
  convertCircuitJsonToPcbSvg(
    [
      ...circuitJson,
      {
        ...createPcbBoardElement(srj),
        center: { x: FRAME.centerX, y: FRAME.centerY },
        width: FRAME.size,
        height: FRAME.size,
        outline: undefined,
      },
    ],
    {
      width: 800,
      height: 800,
      backgroundColor: "white",
      renderSolderMask: false,
      layer: "top",
      drawPaddingOutsideBoard: false,
      shouldDrawErrors: false,
      shouldDrawRatsNest: false,
      includeVersion: false,
    },
  )

const convertFixtureRoutesToTraces = ({
  fixture,
  connMap,
  hdRoutes,
}: {
  fixture: JointRepairFixture
  connMap: ConnectivityMap
  hdRoutes: HighDensityRoute[]
}): SimplifiedPcbTrace[] =>
  convertHdRoutesToSimplifiedPcbTraces({
    connections: fixture.newConnections,
    originalConnections: fixture.originalSrj.connections,
    hdRoutes,
    layerCount: fixture.layerCount,
    obstacles: fixture.obstacles,
    defaultViaHoleDiameter: fixture.defaultViaHoleDiameter,
    connMap,
  })

/** Via-to-pad findings keyed by trace and pad, which stay stable across runs. */
const getViaPadKeys = (errors: Pipeline9DrcError[]): string[] => {
  const keys: string[] = []
  for (const error of errors) {
    if (!isViaPadClearanceError(error)) continue
    const [viaId] = error.pcb_via_ids
    const padId = error.pcb_pad_ids.find((id) => id !== viaId)
    keys.push(`${error.pcb_trace_id} via beside ${padId}`)
  }
  return keys.sort()
}

/**
 * Joint repair input captured on the native A13 remaining phase (64 signals
 * beside four routed data bytes, tscircuit-autorouter#3898's fixture). Joint
 * repair ends with source_net_77 touching source_net_83. The trace contact
 * repair bridges source_net_77 over it with two vias, then moves one via
 * 0.1 mm west at the same DRC count and stops there, 0.068 mm from two RAM
 * pads. One more 0.1 mm step clears both pads and removes two DRC errors.
 */
test("A13 contact repair leaves its new via inside the pad clearance", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/a13-contact-repair-via-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as JointRepairFixture
  const connMap = new ConnectivityMap(fixture.netMap)
  const joint = new Pipeline9JointDrcRepairSolver({
    srj: fixture.srj,
    srjWithPointPairs: fixture.srj,
    originalSrj: fixture.originalSrj,
    newConnections: fixture.newConnections,
    newHdRoutes: fixture.newHdRoutes,
    originalNewHdRoutes: fixture.originalNewHdRoutes,
    updatedPreloadedTraces: fixture.updatedPreloadedTraces,
    mutatedPreloadedTraceIds: new Set(fixture.mutatedPreloadedTraceIds),
    connMap,
    obstacles: fixture.obstacles,
    layerCount: fixture.layerCount,
    defaultViaDiameter: fixture.defaultViaDiameter,
    defaultViaHoleDiameter: fixture.defaultViaHoleDiameter,
    effort: fixture.effort,
    colorMap: {},
  })
  joint.solve()
  expect(joint.solved).toBe(true)

  // Evaluate the way joint repair does: the original request plus the copper
  // it routes around.
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: fixture.originalSrj,
    srjWithPointPairs: fixture.srj,
  })
  const before = evaluate(
    convertFixtureRoutesToTraces({
      fixture,
      connMap,
      hdRoutes: fixture.newHdRoutes,
    }),
  )
  const after = evaluate(
    convertFixtureRoutesToTraces({
      fixture,
      connMap,
      hdRoutes: joint.getOutput(),
    }),
  )
  const inputViaPadKeys = new Set(
    getViaPadKeys(before.errors as Pipeline9DrcError[]),
  )
  const newViaPadKeys = getViaPadKeys(
    after.errors as Pipeline9DrcError[],
  ).filter((key) => !inputViaPadKeys.has(key))

  await expect(renderFrame(before.circuitJson, fixture.srj)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "joint-input" },
  )
  await expect(renderFrame(after.circuitJson, fixture.srj)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "joint-output" },
  )
  expect(newViaPadKeys).toEqual([
    "source_net_77_0 via beside pcb_smtpad_105",
    "source_net_77_0 via beside pcb_smtpad_111",
  ])
})
