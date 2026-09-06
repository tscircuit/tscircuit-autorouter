import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver8 } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport59-82431e/bugreport59-82431e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import type { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { getAssignableViaPointKeys } from "lib/autorouter-pipelines/AutoroutingPipeline8/assignableViaUtils"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"

type StitchInput = ConstructorParameters<
  typeof MultipleHighDensityRouteStitchSolver3
>[0]
type IndexedStitchRoute = StitchInput["hdRoutes"][number] & {
  routeIndex: number
}
type RepresentedVerticalSpan = {
  routeIndex: number
  pointIndex: number
  start: IndexedStitchRoute["route"][number]
  end: IndexedStitchRoute["route"][number]
  throughObstacle: boolean
  listedInRouteVias: boolean
  allowlisted: boolean | undefined
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
  const stitchStep = solver.pipelineDef.find(
    (step): boolean => step.solverName === "highDensityStitchSolver",
  )
  if (!stitchStep) {
    throw new Error("Pipeline8 is missing its high-density stitch stage")
  }
  const getStitchParams = stitchStep.getConstructorParams
  const stitchCapture: { input?: StitchInput } = {}
  // Capture the actual constructor input chosen by Pipeline8, including its
  // merged fixed-via fragments, before a failing constructor can change state.
  stitchStep.getConstructorParams = ((
    instance: AutoroutingPipelineSolver8,
  ): [StitchInput] => {
    const params = getStitchParams(instance) as [StitchInput]
    stitchCapture.input = structuredClone(params[0])
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
      const stitchInput = stitchCapture.input
      const errorMessage =
        solveError instanceof Error
          ? solveError.message
          : String(solveError ?? solver.error)
      const connectionName = errorMessage.match(/for "([^"]+)"/)?.[1]
      const reportedRoutes = stitchInput
        ? stitchInput.hdRoutes
            .map(
              (route, routeIndex): IndexedStitchRoute => ({
                routeIndex,
                ...route,
              }),
            )
            .filter(
              (route): boolean =>
                connectionName === undefined ||
                route.connectionName === connectionName,
            )
        : null
      const representedVerticalSpans = reportedRoutes
        ? reportedRoutes.flatMap((route): RepresentedVerticalSpan[] =>
            route.route
              .slice(0, -1)
              .flatMap((start, pointIndex): RepresentedVerticalSpan[] => {
                const end = route.route[pointIndex + 1]!
                if (
                  start.x !== end.x ||
                  start.y !== end.y ||
                  start.z === end.z
                ) {
                  return []
                }
                return [
                  {
                    routeIndex: route.routeIndex,
                    pointIndex,
                    start,
                    end,
                    throughObstacle:
                      start.toNextSegmentType === "through_obstacle",
                    listedInRouteVias: route.vias.some(
                      (via): boolean => via.x === start.x && via.y === start.y,
                    ),
                    allowlisted:
                      stitchInput?.allowedLayerTransitionPointKeys?.has(
                        getXyPointKey(start),
                      ),
                  },
                ]
              }),
          )
        : null
      console.error(
        "BUGREPORT59_STITCH_FAILURE",
        JSON.stringify({
          phase: solver.getCurrentPhase(),
          error: errorMessage,
          stack: solveError instanceof Error ? solveError.stack : null,
          solved: solver.solved,
          failed: solver.failed,
          connectionName,
          capturedActualStitchInput: stitchInput !== undefined,
          layerCount: stitchInput?.layerCount,
          terminalDeclarations: stitchInput?.connections.filter(
            (connection): boolean =>
              connectionName === undefined ||
              connection.name === connectionName,
          ),
          allowedLayerTransitionPointKeys:
            stitchInput?.allowedLayerTransitionPointKeys === undefined
              ? null
              : [...stitchInput.allowedLayerTransitionPointKeys],
          assignableViaObstacles: solver.originalSrj.obstacles.filter(
            (obstacle): boolean =>
              obstacle.netIsAssignable === true && obstacle.layers.length > 1,
          ),
          handoffRoutes: reportedRoutes,
          representedVerticalSpans,
        }),
      )
    }
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
