import { expect, mock } from "bun:test"
import { dirname } from "node:path"
import type { EvaluateRelaxedDrcInput } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

const checkCalls: string[] = []
const checkModulePaths = new Set([
  Bun.resolveSync("@tscircuit/checks", import.meta.dir),
  Bun.resolveSync(
    "@tscircuit/checks",
    dirname(Bun.resolveSync("high-density-repair03/lib", import.meta.dir)),
  ),
])
for (const checkModulePath of checkModulePaths) {
  const checks: Record<string, unknown> = await import(checkModulePath)
  mock.module(checkModulePath, () =>
    Object.fromEntries(
      Object.entries(checks).map(([name, value]) => [
        name,
        typeof value === "function"
          ? (): never => {
              checkCalls.push(name)
              throw new Error(`Autorouter called @tscircuit/checks.${name}`)
            }
          : value,
      ]),
    ),
  )
}

const {
  AutoroutingPipelineSolver7_MultiGraph,
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
} = await import("lib/index")
const { loadScenarioBySampleNumber } = await import(
  "../../scripts/benchmark/scenarios"
)
const srj: SimpleRouteJson = {
  bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
  layerCount: 2,
  minTraceWidth: 0.1,
  obstacles: [],
  connections: [
    {
      name: "upper",
      pointsToConnect: [
        { x: -2, y: 1, layer: "top", pcb_port_id: "pcb_port_upper_start" },
        { x: 2, y: 1, layer: "top", pcb_port_id: "pcb_port_upper_end" },
      ],
    },
    {
      name: "lower",
      pointsToConnect: [
        { x: -2, y: -1, layer: "top", pcb_port_id: "pcb_port_lower_start" },
        { x: 2, y: -1, layer: "top", pcb_port_id: "pcb_port_lower_end" },
      ],
    },
  ],
}
srj.obstacles = srj.connections.flatMap((connection) =>
  connection.pointsToConnect.map((point) => ({
    type: "rect",
    center: { x: point.x, y: point.y },
    width: 0.4,
    height: 0.4,
    layers: ["top"],
    connectedTo: [connection.name, point.pcb_port_id!],
  })),
)
const pipeline7 = new AutoroutingPipelineSolver7_MultiGraph(
  structuredClone(srj),
  {
    cacheProvider: null,
    effort: 0.1,
  },
)
pipeline7.solve()
expect(pipeline7.solved).toBeTrue()
expect(pipeline7.failed).toBeFalse()
expect(pipeline7.exactGeometryDrcForceImproveSolver).toBeDefined()

const { scenario } = await loadScenarioBySampleNumber("srj23", 74)
const pipeline9 = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  structuredClone(scenario),
  { cacheProvider: null, effort: 1 },
)
pipeline9.solve()
expect(pipeline9.solved).toBeTrue()
expect(pipeline9.failed).toBeFalse()
expect(pipeline9.effortCleanupSolver?.solved).toBeTrue()
const { Pipeline9JointDrcRepairSolver } = await import(
  "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
)
const { convertPipeline7HdRoutesToSimplifiedPcbTraces } = await import(
  "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
)
const { getConnectivityMapFromSimpleRouteJson } = await import(
  "lib/utils/getConnectivityMapFromSimpleRouteJson"
)
const { createBoundedRegionalRepairFixture } = await import(
  "./pipeline9-bounded-regional-repair-fixture"
)
const { originalSrj: repairSrj, routes } = createBoundedRegionalRepairFixture()
const repairConnMap = getConnectivityMapFromSimpleRouteJson(repairSrj)
const repairSolver = new Pipeline9JointDrcRepairSolver({
  srj: repairSrj,
  srjWithPointPairs: repairSrj,
  originalSrj: repairSrj,
  newConnections: repairSrj.connections,
  newHdRoutes: routes,
  updatedPreloadedTraces: [],
  mutatedPreloadedTraceIds: new Set(),
  connMap: repairConnMap,
  obstacles: repairSrj.obstacles,
  layerCount: repairSrj.layerCount,
  defaultViaDiameter: 0.3,
  defaultViaHoleDiameter: 0.15,
  effort: 1,
  colorMap: {},
})
// Use a known pad crossing to exercise the exact branch independently of
// upstream improvements that can make a complete Pipeline9 route clean.
repairSolver.currentPipelineStepIndex = repairSolver.pipelineDef.findIndex(
  (stage) => stage.solverName === "exactRepairSolver",
)
repairSolver.activeSubSolver =
  repairSolver.pipelineDef[
    repairSolver.currentPipelineStepIndex
  ]!.createSolver()
repairSolver.solve()
expect(repairSolver.solved).toBeTrue()
expect(repairSolver.failed).toBeFalse()
expect(repairSolver.stats.initialJointDrcIssueCount).toBeGreaterThan(0)
expect(repairSolver.exactRepairSolver).toBeDefined()

const { HighDensitySolverA13WithDrcValidation } = await import(
  "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
)
const foreignPadSolver = new HighDensitySolverA13WithDrcValidation({
  nodeWithPortPoints: {
    capacityMeshNodeId: "pad-crossing",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0],
    portPoints: [
      { connectionName: "signal", x: -2, y: 0, z: 0 },
      { connectionName: "signal", x: 2, y: 0, z: 0 },
    ],
  },
  traceThickness: 0.1,
  traceMargin: 0.1,
  viaDiameter: 0.3,
  layerCount: 2,
  obstacles: [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["pcb_port_other"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pcb_smtpad_other",
        pcb_port_id: "pcb_port_other",
      },
    },
  ],
})
foreignPadSolver.solve()
expect(foreignPadSolver.solved).toBeFalse()
expect(foreignPadSolver.failed).toBeTrue()
expect(foreignPadSolver.stats.boardDrcIssueCount).toBeGreaterThan(0)
expect(foreignPadSolver.error).toContain("board copper validation")
const ownPadSolver = new HighDensitySolverA13WithDrcValidation({
  ...foreignPadSolver.validationParams,
  obstacles: foreignPadSolver.validationParams.obstacles.map((obstacle) => ({
    ...obstacle,
    connectedTo: [...obstacle.connectedTo, "signal"],
  })),
})
ownPadSolver.solve()
expect(ownPadSolver.solved).toBeTrue()
expect(ownPadSolver.failed).toBeFalse()
expect(ownPadSolver.stats.boardDrcIssueCount).toBe(0)
expect(checkCalls).toEqual([])

const results: EvaluateRelaxedDrcInput[] = [
  {
    inputSrj: srj,
    srjWithPointPairs: pipeline7.srjWithPointPairs!,
    routedTraces: pipeline7.getOutputSimplifiedPcbTraces(),
  },
  {
    inputSrj: scenario,
    srjWithPointPairs: pipeline9.srjWithPointPairs!,
    routedTraces: pipeline9.getOutputSimplifiedPcbTraces(),
  },
  {
    inputSrj: repairSrj,
    srjWithPointPairs: repairSrj,
    routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: repairSrj.connections,
      originalConnections: repairSrj.connections,
      hdRoutes: repairSolver.getOutput(),
      layerCount: repairSrj.layerCount,
      obstacles: repairSrj.obstacles,
      defaultViaHoleDiameter: 0.15,
      connMap: repairConnMap,
    }),
  },
]
process.stdout.write(`AUTOROUTER_RESULT=${JSON.stringify(results)}\n`)
