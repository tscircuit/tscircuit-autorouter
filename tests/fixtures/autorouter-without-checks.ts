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
  AutoroutingPipelineSolver,
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
const pipeline7 = new AutoroutingPipelineSolver(structuredClone(srj), {
  cacheProvider: null,
  effort: 0.1,
})
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
expect(
  pipeline9.pipeline9JointDrcRepairSolver?.stats.initialJointDrcIssueCount,
).toBeGreaterThan(0)
expect(pipeline9.pipeline9JointDrcRepairSolver?.exactRepairSolver).toBeDefined()
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
]
process.stdout.write(`AUTOROUTER_RESULT=${JSON.stringify(results)}\n`)
