import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { applyBroadRepulsionForces } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 enables isolated broad proposals for its native Global solver", () => {
  const routes: HighDensityRoute[] = [0, 0.1].map((y, index) => ({
    connectionName: `route-${index}`,
    traceThickness: 0.2,
    viaDiameter: 0.3,
    route: [-2, 0, 2].map((x) => ({ x, y, z: 0 })),
    vias: [],
  }))
  const connections = routes.map((route) => ({
    name: route.connectionName,
    pointsToConnect: [route.route[0]!, route.route[2]!].map(({ x, y }) => ({
      x, y, layer: "top",
    })),
  }))
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph({
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections,
  }, { effort: 1, cacheProvider: null })
  pipeline.srjWithPointPairs = pipeline.srj
  pipeline.traceWidthSolver = {
    getHdRoutesWithWidths: (): HighDensityRoute[] => routes,
  } as typeof pipeline.traceWidthSolver
  pipeline.netToPointPairsSolver = { newConnections: connections } as typeof pipeline.netToPointPairsSolver
  const stage = pipeline.pipelineDef.find(
    (step) => step.solverName === "globalDrcForceImproveSolver",
  )!
  const params = stage.getConstructorParams(pipeline)[0] as
    ConstructorParameters<typeof GlobalDrcForceImproveSolver>[0]
  expect(stage.solverClass).toBe(GlobalDrcForceImproveSolver)
  expect(params.enableBroadProposalCache).toBe(true)
  expect(params.autoroutingDrcEngine).toBeUndefined()
  expect(params.maxIterations).toBe(16)
  const solver = new GlobalDrcForceImproveSolver(params)
  const internal = solver as any
  expect(internal.canCacheBroadProposals).toBe(true)
  expect(solver.getConstructorParams()[0].enableBroadProposalCache).toBe(true)
  const base = params.hdRoutes
  const original = structuredClone(base)
  for (const multiplier of [1, 2]) {
    const expected = applyBroadRepulsionForces(
      params.srj, base, solver.effort, multiplier, params.connMap, true, false,
    )
    const first = internal.getBroadCandidateRoutes(base, multiplier)
    expect(first).toEqual(expected)
    expect(first).not.toBe(base)
    first[0].route[1].x += 100
    const second = internal.getBroadCandidateRoutes(base, multiplier)
    expect(second).toEqual(expected)
    expect(second).not.toBe(first)
    expect(second[0]).not.toBe(first[0])
    expect(second[0].route[1]).not.toBe(first[0].route[1])
    second[0].route[1].y += 100
    expect(internal.getBroadCandidateRoutes(base, multiplier)).toEqual(expected)
  }
  expect(base).toEqual(original)
  const accepted = structuredClone(base)
  accepted[0].route[1].y += 0.15
  expect(internal.getBroadCandidateRoutes(accepted, 2)).toEqual(
    applyBroadRepulsionForces(
      params.srj, accepted, solver.effort, 2, params.connMap, true, false,
    ),
  )
  expect(internal.broadProposalCache.bestRoutes).toBe(accepted)
  const empty: HighDensityRoute[] = []
  expect(internal.getBroadCandidateRoutes(empty, 1)).toBe(empty)
  expect(internal.getBroadCandidateRoutes(empty, 1)).toBe(empty)
  expect(internal.broadProposalCache.proposals[0]).toBeNull()
  const getterReads: string[] = []
  const explicitEngineParams = Object.defineProperties({ ...params }, {
    drcEvaluator: { get: () => { getterReads.push("drcEvaluator"); return undefined } },
    referenceDrcEvaluator: { get: () => { getterReads.push("referenceDrcEvaluator"); return undefined } },
    autoroutingDrcEngine: { get: () => { getterReads.push("autoroutingDrcEngine"); return solver.autoroutingDrcEngine } },
  })
  const suppliedEngineSolver = new GlobalDrcForceImproveSolver(explicitEngineParams)
  expect(getterReads).toEqual([
    "drcEvaluator", "referenceDrcEvaluator", "autoroutingDrcEngine",
  ])
  expect(suppliedEngineSolver.autoroutingDrcEngine).toBe(solver.autoroutingDrcEngine)
  expect((suppliedEngineSolver as any).canCacheBroadProposals).toBe(false)
})
