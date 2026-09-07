import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver8 } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport59-82431e/bugreport59-82431e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { getAssignableViaPointKeys } from "lib/autorouter-pipelines/AutoroutingPipeline8/assignableViaUtils"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import type { UnsolvedRoute3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type CapturedStitchInput = {
  solver: SingleHighDensityRouteStitchSolver3
  input: UnsolvedRoute3
  routeReferences: HighDensityIntraNodeRoute[]
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport59-82431e.json", () => {
  const solver = new AutoroutingPipelineSolver8(srj)
  solver.solve()
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
}, 30_000)

test("bugreport59-82431e keeps effort 2 vias on preplaced assignable vias", () => {
  const solver = new AutoroutingPipelineSolver8(srj, { effort: 2 })
  const stitchInputCapture: { current?: CapturedStitchInput } = {}
  const advancePipeline = solver._step.bind(solver)
  solver._step = (): void => {
    const stitchSolver = solver.highDensityStitchSolver
    const nextInput = stitchSolver?.activeSolver
      ? undefined
      : stitchSolver?.unsolvedRoutes.at(-1)
    const nextInputSnapshot = nextInput ? structuredClone(nextInput) : undefined
    advancePipeline()
    const activeStitch = solver.highDensityStitchSolver?.activeSolver
    if (
      nextInput &&
      nextInputSnapshot &&
      activeStitch &&
      stitchInputCapture.current?.solver !== activeStitch
    ) {
      stitchInputCapture.current = {
        solver: activeStitch,
        input: nextInputSnapshot,
        routeReferences: [...nextInput.hdRoutes],
      }
    }
  }
  solver.solve()
  if (!solver.solved) {
    const stitchSolver = solver.highDensityStitchSolver
    const failedStitch = stitchSolver?.activeSolver
    const capturedStitchInput = stitchInputCapture.current
    if (
      stitchSolver &&
      failedStitch?.failed &&
      capturedStitchInput &&
      capturedStitchInput.solver === failedStitch
    ) {
      const input = capturedStitchInput.input
      const routeReferences = capturedStitchInput.routeReferences
      const connectionNames = new Set([
        input.connectionName,
        ...input.hdRoutes.map((route): string => route.connectionName),
      ])
      console.error(
        "BUGREPORT59_STITCH_FAILURE_JSON",
        JSON.stringify({
          phase: solver.getCurrentPhase(),
          error: solver.error,
          constructorInput: input,
          constructorOptions: {
            defaultTraceThickness: stitchSolver.defaultTraceThickness,
            defaultViaDiameter: stitchSolver.defaultViaDiameter,
            preserveTerminalPcbPortIds: stitchSolver.preserveTerminalPcbPortIds,
            stitchClearanceMode: failedStitch.stitchClearanceMode,
          },
          materializationStart: failedStitch.start,
          materializationEnd: failedStitch.end,
          allowedLayerTransitionPointKeys:
            failedStitch.allowedLayerTransitionPointKeys === undefined
              ? null
              : [...failedStitch.allowedLayerTransitionPointKeys],
          mergedHdRoute: failedStitch.mergedHdRoute,
          remainingInputIndexes: failedStitch.remainingHdRoutes.map(
            (route): number => routeReferences.indexOf(route),
          ),
          parentConnections: solver.srjWithPointPairs?.connections.filter(
            (connection): boolean => connectionNames.has(connection.name),
          ),
          originalConnections: solver.originalSrj.connections.filter(
            (connection): boolean => connectionNames.has(connection.name),
          ),
          unselectedConnectionRoutes: solver.highDensityRepairRoutes?.filter(
            (route): boolean =>
              connectionNames.has(route.connectionName) &&
              !routeReferences.includes(route),
          ),
          connectionNodes: solver.highDensityNodePortPoints?.filter(
            (node): boolean =>
              node.portPoints.some((point): boolean =>
                connectionNames.has(point.connectionName),
              ),
          ),
        }),
      )
    }
    throw new Error(
      `bugreport59 effort 2 routing did not complete in ${solver.getCurrentPhase()}: ${String(solver.error)}`,
    )
  }

  const allowedViaPointKeys = getAssignableViaPointKeys(srj.obstacles)
  const outputVias = solver
    .getOutputSimplifiedPcbTraces()
    .flatMap((trace) =>
      trace.route.filter((segment) => segment.route_type === "via"),
    )

  expect(outputVias.length).toBeGreaterThan(0)
  expect(
    outputVias.filter((via) => !allowedViaPointKeys.has(getXyPointKey(via))),
  ).toEqual([])
}, 30_000)
