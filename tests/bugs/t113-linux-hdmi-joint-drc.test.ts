import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { getPowerTraceExpansionConnectionNames } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/getPowerTraceExpansionConnectionNames"
import { preparePipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/convertSimplifiedPcbTraceToHighDensityRoute"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { PostPowerTraceViaMergeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PostPowerTraceViaMergeSolver"
import { assignUniquePcbTraceIdsToNewTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces"
import { filterPipeline9DrcErrorsAgainstBaseline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/filterPipeline9DrcErrorsAgainstBaseline"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { stackSvgsHorizontally } from "stack-svgs"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-hdmi-joint-drc/"
const readCompressedFixture = <T>(filename: string): T =>
  JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(new URL(`${fixtureDirectory}${filename}`, import.meta.url)),
      ),
    ).toString("utf8"),
  ) as T

const unroutedCircuitJson = readCompressedFixture<CircuitJson>(
  "t113-linux-hdmi-unrouted.circuit.json.gz",
)
const fixture = readCompressedFixture<{
  originalSrj: SimpleRouteJson
  updatedPreloadedTraces: SimplifiedPcbTraces
  newTraces: SimplifiedPcbTraces
}>("t113-linux-hdmi-joint-drc-input.json.gz")

test("Pipeline9 repairs the exact 96-component T113-S3 HDMI PCB", async () => {
  expect(
    unroutedCircuitJson.filter(
      (element) => element.type === "source_component",
    ),
  ).toHaveLength(96)
  expect(
    unroutedCircuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(96)
  expect(
    unroutedCircuitJson.filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    ),
  ).toEqual([])
  expect(fixture.originalSrj.obstacles).toHaveLength(397)
  expect(fixture.originalSrj.connections).toHaveLength(29)
  expect(fixture.originalSrj.traces).toHaveLength(342)
  expect(fixture.updatedPreloadedTraces).toHaveLength(342)
  expect(fixture.newTraces).toHaveLength(42)

  const setupSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(fixture.originalSrj),
    { cacheProvider: null },
  )
  while (!setupSolver.srjWithPointPairs && !setupSolver.failed) {
    setupSolver.step()
  }
  expect(setupSolver.failed).toBe(false)
  expect(setupSolver.srjWithPointPairs).toBeDefined()

  const newConnectionNames = new Set(
    setupSolver.netToPointPairsSolver!.newConnections.map(
      (connection) => connection.name,
    ),
  )
  const viaDimensions = getViaDimensions(fixture.originalSrj)
  const newHdRoutes = fixture.newTraces.map((trace) => {
    const traceWidths = trace.route.flatMap((point) =>
      point.route_type === "wire" ? [point.width] : [],
    )
    const connectionName = trace.pcb_trace_id.replace(/_0$/, "")
    expect(newConnectionNames.has(connectionName)).toBe(true)
    const route = convertSimplifiedPcbTraceToHighDensityRoute(trace, {
      layerCount: fixture.originalSrj.layerCount,
      defaultTraceThickness: Math.max(...traceWidths),
      defaultViaDiameter: viaDimensions.padDiameter,
      rootConnectionName:
        setupSolver.connMap.getNetConnectedToId(trace.connection_name) ??
        trace.connection_name,
    })
    route.connectionName = connectionName
    return route
  })
  const jointSolver = new Pipeline9JointDrcRepairSolver({
    srj: {
      ...setupSolver.srjWithPointPairs!,
      traces: fixture.updatedPreloadedTraces,
    },
    srjWithPointPairs: {
      ...setupSolver.srjWithPointPairs!,
      traces: fixture.updatedPreloadedTraces,
    },
    originalSrj: fixture.originalSrj,
    newConnections: setupSolver.netToPointPairsSolver!.newConnections,
    newHdRoutes,
    updatedPreloadedTraces: fixture.updatedPreloadedTraces,
    mutatedPreloadedTraceIds: new Set(
      fixture.updatedPreloadedTraces.flatMap((trace) =>
        trace.__replaces_pcb_trace_id ? [trace.pcb_trace_id] : [],
      ),
    ),
    connMap: setupSolver.connMap,
    obstacles: fixture.originalSrj.obstacles,
    layerCount: fixture.originalSrj.layerCount,
    defaultViaDiameter: viaDimensions.padDiameter,
    defaultViaHoleDiameter: viaDimensions.holeDiameter,
    effort: 1,
    colorMap: setupSolver.colorMap,
  })
  jointSolver.solve()
  expect(jointSolver.failed).toBe(false)
  expect(jointSolver.solved).toBe(true)
  expect(jointSolver.stats).toMatchObject({
    postExactReferenceAccepted: false,
    regionalB01RepairRemainingDrcIssueCount: 0,
  })

  const convertedNewTraces =
    convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: setupSolver.netToPointPairsSolver!.newConnections,
      originalConnections: fixture.originalSrj.connections,
      hdRoutes: jointSolver.getOutput(),
      layerCount: fixture.originalSrj.layerCount,
      obstacles: fixture.originalSrj.obstacles,
      defaultViaHoleDiameter: viaDimensions.holeDiameter,
      connMap: setupSolver.connMap,
    })
  const newTraces = assignUniquePcbTraceIdsToNewTraces(
    convertedNewTraces,
    fixture.originalSrj.traces ?? [],
  )
  const expandedConnectionNames =
    getPowerTraceExpansionConnectionNames(fixture.originalSrj)
  const powerInput = preparePipeline7PowerTraceExpansionInput({
    originalSrj: fixture.originalSrj,
    newlyRoutedTraces: newTraces,
    currentPreloadedTraces: jointSolver.getUpdatedPreloadedTraces(),
    expandedConnectionNames,
    resolveConnectedTraceAliases: true,
  })
  const powerSolver = new PowerTraceExpansionSolver(powerInput, {
    allowNewVias: false,
    onlyConnectionNames: expandedConnectionNames,
  })
  powerSolver.solve()
  expect(powerSolver.failed).toBe(false)
  const postPowerSolver = new PostPowerTraceViaMergeSolver({
    inputSrj: fixture.originalSrj,
    inputTraces: powerSolver.getOutput(),
    otherTraces: powerInput.fixedTraces,
    connMap: setupSolver.connMap,
    colorMap: setupSolver.colorMap,
    viaDiameter: viaDimensions.padDiameter,
    viaHoleDiameter: viaDimensions.holeDiameter,
  })
  postPowerSolver.solve()
  expect(postPowerSolver.failed).toBe(false)

  const routedTraces = postPowerSolver.getOutput()
  const drcOptions = {
    traceClearance:
      fixture.originalSrj.minTraceToPadEdgeClearance ?? 0.1,
    viaPadClearance:
      fixture.originalSrj.minViaEdgeToPadEdgeClearance ?? 0.1,
    includeTraceContinuity: false,
  }
  const baselineDrc = evaluateRelaxedDrc({
    inputSrj: fixture.originalSrj,
    srjWithPointPairs: setupSolver.srjWithPointPairs!,
    routedTraces: [],
    drcOptions,
  })
  const finalDrc = evaluateRelaxedDrc({
    inputSrj: { ...fixture.originalSrj, traces: powerInput.fixedTraces },
    srjWithPointPairs: setupSolver.srjWithPointPairs!,
    routedTraces,
    drcOptions,
  })
  expect(
    filterPipeline9DrcErrorsAgainstBaseline({
      errors: finalDrc.errors as unknown as Array<Record<string, unknown>>,
      baselineErrors: baselineDrc.errors as unknown as Array<
        Record<string, unknown>
      >,
      originalTraceIdByPreparedTraceId: new Map(),
    }),
  ).toEqual([])
  expect(
    finalDrc.errors.filter(
      (error) => error.type === "pcb_pad_pad_clearance_error",
    ),
  ).toEqual([])

  const allRoutedTraces: SimplifiedPcbTrace[] = [
    ...powerInput.fixedTraces,
    ...routedTraces,
  ]
  const routedCopper = convertToCircuitJson(
    fixture.originalSrj,
    allRoutedTraces,
  ).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  expect(
    routedCopper.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(384)
  expect(
    routedCopper.filter((element) => element.type === "pcb_via"),
  ).toHaveLength(297)
  await expect(
    stackSvgsHorizontally(
      [
        convertCircuitJsonToPcbSvg(unroutedCircuitJson),
        convertCircuitJsonToPcbSvg([
          ...unroutedCircuitJson,
          ...routedCopper,
        ]),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "unrouted-routed",
    tolerance: 0,
  })
})
