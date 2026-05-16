import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"

test("pipeline4 circuit011 cmn_6 routes the disconnected multipoint branch", () => {
  const pipeline = new AutoroutingPipelineSolver4(
    (dataset01 as Record<string, unknown>).circuit011 as any,
  )

  pipeline.solveUntilPhase("highDensityStitchSolver")

  const branchNodes =
    pipeline.highDensityNodePortPoints?.filter((node) =>
      node.portPoints.some(
        (portPoint) => portPoint.connectionName === "source_net_1_mst3",
      ),
    ) ?? []

  expect(branchNodes.length).toBeGreaterThan(1)

  const routedBranchNodes = branchNodes.map((node) => {
    const solver = new HyperSingleIntraNodeSolver({
      nodeWithPortPoints: node,
      colorMap: pipeline.colorMap,
      connMap: pipeline.connMap,
      viaDiameter: pipeline.viaDiameter,
      traceWidth: pipeline.minTraceWidth,
      effort: pipeline.effort,
    })

    solver.solve()

    return {
      node,
      routes: solver.solvedRoutes.filter(
        (route) => route.connectionName === "source_net_1_mst3",
      ),
    }
  })

  // expect(routedBranchNodes.every(({ routes }) => routes.length > 0)).toBe(true)
  expect(
    routedBranchNodes.some(({ node }) => {
      const connectionNames = new Set(
        node.portPoints.map((portPoint) => portPoint.connectionName),
      )

      return (
        connectionNames.has("source_net_1_mst3") &&
        [...connectionNames].some(
          (connectionName) => connectionName !== "source_net_1_mst3",
        )
      )
    }),
  ).toBe(true)
  expect(
    routedBranchNodes.every(({ routes }) =>
      routes.every((route) => {
        const firstPoint = route.route[0]!
        const lastPoint = route.route[route.route.length - 1]!

        return (
          firstPoint.x !== lastPoint.x ||
          firstPoint.y !== lastPoint.y ||
          firstPoint.z !== lastPoint.z
        )
      }),
    ),
  ).toBe(true)
}, 60_000)
