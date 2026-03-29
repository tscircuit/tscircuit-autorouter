import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"

test("pipeline4 circuit011 cmn_6 routes the disconnected multipoint branch", () => {
  const pipeline = new AutoroutingPipelineSolver4(
    (dataset01 as Record<string, unknown>).circuit011 as any,
  )

  pipeline.solveUntilPhase("highDensityStitchSolver")

  const node =
    pipeline.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_6")?.node

  expect(node).toBeDefined()

  const solver = new HyperSingleIntraNodeSolver({
    nodeWithPortPoints: node!,
    colorMap: pipeline.colorMap,
    connMap: pipeline.connMap,
    viaDiameter: pipeline.viaDiameter,
    traceWidth: pipeline.minTraceWidth,
    effort: pipeline.effort,
  })

  solver.solve()

  const sourceNet1Routes = solver.solvedRoutes.filter(
    (route) => route.connectionName === "source_net_1_mst3",
  )

  expect(sourceNet1Routes.length).toBe(2)
  expect(
    sourceNet1Routes.some(
      (route) =>
        route.route[0]!.x === route.route[route.route.length - 1]!.x &&
        route.route[0]!.y === route.route[route.route.length - 1]!.y &&
        route.route[0]!.z === route.route[route.route.length - 1]!.z,
    ),
  ).toBe(false)
  expect(
    sourceNet1Routes.some((route) =>
      route.route.some(
        (point) =>
          Math.abs(point.x - 11.499872000000096) < 1e-6 &&
          Math.abs(point.y - 4.774996100000033) < 1e-6 &&
          point.z === 0,
      ),
    ),
  ).toBe(true)
}, 60_000)
