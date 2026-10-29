import { expect, test } from "bun:test"
import { AutoroutingDrcEngine, GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { GlobalDeltaDrcEngine } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/GlobalDeltaDrcEngine"
import { createBoundedRegionalRepairFixture } from "./fixtures/pipeline9-bounded-regional-repair-fixture"

test("Pipeline9 injects the persistent engine only into the requested actual GlobalFI stage", () => {
  const outputs: unknown[] = []
  for (const requested of [undefined, false, true]) {
    const fixture = createBoundedRegionalRepairFixture(2)
    fixture.originalSrj.minTraceToPadEdgeClearance = 0.11
    for (const obstacle of fixture.originalSrj.obstacles) {
      obstacle.connectedTo.push(`pcb_smtpad_${obstacle.circuitJsonMetadata!.pcb_smtpad_id}`)
    }
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(fixture.originalSrj, {
      cacheProvider: null,
      ...(requested === undefined ? {} : { experimentDeltaDrc: requested }),
    })
    pipeline.srjWithPointPairs = fixture.originalSrj
    pipeline.traceWidthSolver = {
      getHdRoutesWithWidths: () => fixture.routes,
    } as typeof pipeline.traceWidthSolver
    pipeline.netToPointPairsSolver = {
      newConnections: fixture.originalSrj.connections,
    } as typeof pipeline.netToPointPairsSolver
    expect(pipeline.globalDeltaDrcStats).toBeUndefined()
    const stage = pipeline.pipelineDef.find((step) => step.solverName === "globalDrcForceImproveSolver")!
    const [params] = stage.getConstructorParams(pipeline) as ConstructorParameters<typeof GlobalDrcForceImproveSolver>
    const solver = new GlobalDrcForceImproveSolver(params)
    expect(params.drcEvaluator).toBeUndefined()
    expect(solver.autoroutingDrcEngine).toBeInstanceOf(AutoroutingDrcEngine)
    if (requested === true) {
      expect(params.autoroutingDrcEngine).toBeInstanceOf(GlobalDeltaDrcEngine)
      expect(pipeline.globalDeltaDrcStats).toBe((params.autoroutingDrcEngine as GlobalDeltaDrcEngine).globalStats)
      expect(pipeline.globalDeltaDrcStats!.globalDeltaDrcActivated).toBeFalse()
      expect(pipeline.globalDeltaDrcStats!.deltaDrcCalls).toBe(0)
    } else {
      expect(params.autoroutingDrcEngine).toBeUndefined()
      expect(pipeline.globalDeltaDrcStats).toBeUndefined()
    }
    solver.solve()
    outputs.push({ output: solver.getOutput(), solved: solver.solved, failed: solver.failed, iterations: solver.iterations })
    if (requested === true) {
      expect(pipeline.globalDeltaDrcStats!.globalDeltaDrcActivated).toBeTrue()
      expect(pipeline.globalDeltaDrcStats!.deltaDrcCalls).toBeGreaterThan(2)
      expect(pipeline.globalDeltaDrcStats!.deltaDrcTouchedQueries).toBeGreaterThan(0)
      expect(pipeline.globalDeltaDrcStats!.deltaDrcReusedQueries).toBeGreaterThan(0)
      expect(pipeline.globalDeltaDrcStats!.deltaDrcChangedCandidateCalls).toBeGreaterThan(0)
      expect(Object.keys(pipeline.globalDeltaDrcStats!).length).toBeLessThanOrEqual(16)
    }
  }
  expect(outputs[1]).toEqual(outputs[0])
  expect(outputs[2]).toEqual(outputs[0])
})
