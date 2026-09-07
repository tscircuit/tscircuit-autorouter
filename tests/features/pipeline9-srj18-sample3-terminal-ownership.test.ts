import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type StitchInput = ConstructorParameters<
  typeof MultipleHighDensityRouteStitchSolver3
>[0]
type FragmentOwnership = {
  connectionName: string
  rootConnectionName?: string
  regionId?: string
  startPcbPortId?: string
  endPcbPortId?: string
  start: StitchInput["hdRoutes"][number]["route"][number] | undefined
  end: StitchInput["hdRoutes"][number]["route"][number] | undefined
}

test("Pipeline9 preserves SRJ18 sample3's child-terminal ownership and clean completion", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 3)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  const stitchStep = solver.pipelineDef.find(
    (step): boolean => step.solverName === "highDensityStitchSolver",
  )
  if (!stitchStep) {
    throw new Error("Pipeline9 is missing its high-density stitch stage")
  }
  const getStitchParams = stitchStep.getConstructorParams
  const capture: { input?: StitchInput } = {}
  stitchStep.getConstructorParams = ((
    instance: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ): [StitchInput] => {
    const params = getStitchParams(instance) as [StitchInput]
    capture.input = structuredClone(params[0])
    return params
  }) as typeof stitchStep.getConstructorParams

  let solveError: unknown
  try {
    solver.solve()
  } catch (error) {
    solveError = error
    throw error
  } finally {
    stitchStep.getConstructorParams = getStitchParams
    if (solveError !== undefined || !solver.solved) {
      const errorMessage =
        solveError instanceof Error ? solveError.message : String(solver.error)
      const connectionName = errorMessage.match(/(?:on|for) "([^"]+)"/)?.[1]
      console.error(
        "SRJ18_SAMPLE3_TERMINAL_OWNERSHIP_FAILURE",
        JSON.stringify({
          phase: solver.getCurrentPhase(),
          connectionName,
          childPairDeclarations: capture.input?.connections.filter(
            (connection): boolean => connection.name === connectionName,
          ),
          inputFragmentOwnership: capture.input?.hdRoutes
            .filter((route): boolean => route.connectionName === connectionName)
            .map(
              (route): FragmentOwnership => ({
                connectionName: route.connectionName,
                rootConnectionName: route.rootConnectionName,
                regionId: route.regionId,
                startPcbPortId: route.startPcbPortId,
                endPcbPortId: route.endPcbPortId,
                start: route.route[0],
                end: route.route[route.route.length - 1],
              }),
            ),
          // The named guard includes its selected ordered physical fragments.
          // Emit it once, after the actual declaration, to avoid truncating
          // ownership evidence with a duplicate error stack.
          rejection: errorMessage,
        }),
      )
    }
  }

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const finalDrc = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(finalDrc.errors).toEqual([])
})
