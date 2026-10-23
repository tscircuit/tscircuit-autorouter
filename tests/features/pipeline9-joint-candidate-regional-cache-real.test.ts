import { expect, spyOn, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import * as allocation from "lib/solvers/PortPointPathingSolver/tinyhypergraph/allocateCompatibleTinyRouteCandidates"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { copyCompleteJointCandidate, jointCandidateSemanticStats } from "../fixtures/createJointCandidateCacheFixture"

test("real native-round candidate pools on SRJ18 boards 1 and 3 produce exactly the uncached master's assignment and native pressure", async (): Promise<void> => {
  const allocate = allocation.allocateCompatibleTinyRouteCandidates
  for (const sample of [1, 3]) {
    let calls = 0
    const interception = spyOn(allocation, "allocateCompatibleTinyRouteCandidates").mockImplementation((baseline, alternatives, provenance) => {
      const oracle = copyCompleteJointCandidate(baseline)
      const copied = (Array.isArray(alternatives) ? alternatives : [alternatives]).map(copyCompleteJointCandidate)
      const uncached = allocate(oracle, copied, { ...provenance, regionalScoreCacheCapacity: 0 })
      const cached = allocate(baseline, alternatives, provenance)
      expect(jointCandidateSemanticStats(cached)).toEqual(jointCandidateSemanticStats(uncached))
      expect(baseline.state.regionSegments).toEqual(oracle.state.regionSegments)
      expect(baseline.state.portAssignment).toEqual(oracle.state.portAssignment)
      expect(baseline.state.regionIntersectionCaches).toEqual(oracle.state.regionIntersectionCaches)
      expect(cached.jointCandidateScoreCacheHits).toBeGreaterThan(0)
      expect(cached.jointCandidateScoredSegmentPairs).toBeLessThan(uncached.jointCandidateScoredSegmentPairs)
      if (process.env.PIPELINE9_REGIONAL_CACHE_WORK_CAPTURE === "1") console.log(JSON.stringify({ sample, cached, uncached }))
      calls++
      return cached
    })
    try {
      const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
      const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
      solver.solve()
      expect(solver.solved, solver.error ?? "").toBe(true)
      expect(solver.failed).toBe(false)
      expect(calls).toBeGreaterThan(0)
      expect(evaluateRelaxedDrc({ inputSrj: scenario, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: solver.getOutputSimplifiedPcbTraces() }).errors).toHaveLength(0)
    } finally {
      interception.mockRestore()
    }
  }
})
