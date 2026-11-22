import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { getPipeline9DrcContact } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type {
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  AutoroutingDrcEngine,
  type SimpleRouteJson as RepairSimpleRouteJson,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
} from "high-density-repair03/lib"
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

// The RAM balls west of the A13 fanout, where source_net_77 runs.
const FRAME = { centerX: -5.95, centerY: 2.5, size: 3.2 }

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

/**
 * Joint repair input captured on the native A13 remaining phase (64 signals
 * beside four routed data bytes), with tscircuit-autorouter#3906 applied: the
 * routes entering Pipeline9JointDrcRepairSolver. The regional repair's refine
 * step moves source_net_77 off earlier copper and onto RAM pads of other nets
 * it did not touch before, then keeps the result because it has fewer DRC
 * errors.
 */
const convertFixtureRoutesToTraces = ({
  fixture,
  connMap,
  hdRoutes,
}: {
  fixture: JointRepairFixture
  connMap: ConnectivityMap
  hdRoutes: HighDensityRoute[]
}): SimplifiedPcbTrace[] =>
  convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: fixture.newConnections,
    originalConnections: fixture.originalSrj.connections,
    hdRoutes,
    layerCount: fixture.layerCount,
    obstacles: fixture.obstacles,
    defaultViaHoleDiameter: fixture.defaultViaHoleDiameter,
    connMap,
  })

/** The contacts the DRC engine reports, keyed as joint repair compares them. */
const getContactKeys = ({
  drcEngine,
  traces,
}: {
  drcEngine: AutoroutingDrcEngine
  traces: SimplifiedPcbTrace[]
}): string[] => {
  const contactKeys: string[] = []
  const { errors } = drcEngine.evaluate(traces as RepairSimplifiedPcbTraces)
  for (const error of errors) {
    const contact = getPipeline9DrcContact(error)
    if (!contact) continue
    contactKeys.push(
      contact.kind === "identified" ? contact.key : "unidentified contact",
    )
  }
  return contactKeys
}

test("A13 joint repair moves a trace onto pads of other nets", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/a13-joint-repair-pad-contacts.json.gz",
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
  // Contacts as the DRC engine joint repair compares candidates with.
  const drcEngine = new AutoroutingDrcEngine(
    {
      ...fixture.srj,
      obstacles: fixture.originalSrj.obstacles,
    } as RepairSimpleRouteJson,
    { connMap },
  )
  const inputTraces = convertFixtureRoutesToTraces({
    fixture,
    connMap,
    hdRoutes: fixture.newHdRoutes,
  })
  const outputTraces = convertFixtureRoutesToTraces({
    fixture,
    connMap,
    hdRoutes: joint.getOutput(),
  })
  const before = evaluate(inputTraces)
  const after = evaluate(outputTraces)
  const inputContacts = new Set(
    getContactKeys({ drcEngine, traces: inputTraces }),
  )
  const outputContacts = getContactKeys({ drcEngine, traces: outputTraces })
  const newContacts = outputContacts.filter(
    (contact) => !inputContacts.has(contact),
  )

  await expect(renderFrame(before.circuitJson, fixture.srj)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "joint-input" },
  )
  await expect(renderFrame(after.circuitJson, fixture.srj)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "joint-output" },
  )
  expect(newContacts).toEqual([])
})
