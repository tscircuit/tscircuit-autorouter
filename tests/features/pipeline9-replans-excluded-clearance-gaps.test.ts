import { expect, test } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { PortPointId } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/findConflictingGaps"
import type { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import { assertDefined } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/assertDefined"
import type { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"

type GapPlan = {
  mesh: PreloadedTraceGraphSolver
  offered: Set<PortPointId>
  assigned: Set<PortPointId | undefined>
}

function captureGapPlan(
  pathing: TinyHypergraphPortPointPathingSolver,
  mesh: PreloadedTraceGraphSolver,
): GapPlan {
  const [{ graph }] = pathing.getConstructorParams()
  const { nodesWithPortPoints } = pathing.getOutput()
  return {
    mesh,
    offered: new Set(graph.ports.map(({ d }) => d.portId)),
    assigned: new Set(
      nodesWithPortPoints.flatMap(({ portPoints }) =>
        portPoints.map(({ portPointId }) => portPointId),
      ),
    ),
  }
}

test("iCEPi keeps rejected crossings out of later path searches after the mesh rebuilds", () => {
  const fixture = new URL(
    "../fixtures/assets/icepi-native-ddr-gap-ports.srj.json.gz",
    import.meta.url,
  )
  const { inputSrj }: { inputSrj: SimpleRouteJson } = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixture))).toString("utf8"),
  )
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    inputSrj,
    { cacheProvider: null },
  )
  const plans: GapPlan[] = []
  while (
    !pipeline.failed &&
    !pipeline.solved &&
    pipeline.getCurrentPhase() !== "uniformPortDistributionSolver"
  ) {
    const stage = pipeline.activeSubSolver
    if (stage) {
      stage.solve()
      if (stage === pipeline.portPointPathingSolver) {
        const plan = captureGapPlan(
          pipeline.portPointPathingSolver,
          pipeline.preloadedTraceGraphSolver!,
        )
        const previous = plans.at(-1)
        if (previous?.mesh === plan.mesh) {
          expect(plan.offered.size).toBeLessThan(previous.offered.size)
        }
        plans.push(plan)
      }
    }
    pipeline.step()
  }
  expect(pipeline.getCurrentPhase()).toBe("uniformPortDistributionSolver")
  const [first, retry] = plans
  assertDefined(first, "Expected the initial iCEPi path search")
  assertDefined(retry, "Expected a second iCEPi path search")
  expect(retry.mesh).toBe(first.mesh)
  expect(plans.some(({ mesh }) => mesh !== first.mesh)).toBeTrue()

  const rejected = [...first.mesh.clearanceGapsByPortId].filter(
    ([id]) =>
      first.assigned.has(id) && first.offered.has(id) && !retry.offered.has(id),
  )
  expect(rejected.length).toBeGreaterThan(0)
  for (const plan of plans.slice(1)) {
    for (const [, gap] of rejected) {
      // Locate the physical crossing independently of the router’s exclusion lookup.
      const matches = [...plan.mesh.clearanceGapsByPortId].filter(
        ([, candidate]) =>
          candidate.z === gap.z && distance(candidate.port, gap.port) < 1e-6,
      )
      expect(matches).toHaveLength(1)
      const [id] = matches[0]!
      expect(plan.offered.has(id)).toBeFalse()
      expect(plan.assigned.has(id)).toBeFalse()
    }
  }
})
