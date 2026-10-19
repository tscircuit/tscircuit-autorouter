import { expect } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { stackSvgsHorizontally } from "stack-svgs"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

export async function expectSitaraRoutingPreparation({
  sampleNumber,
  boardName,
  testPath,
}: {
  sampleNumber: number
  boardName: string
  testPath: string
}): Promise<void> {
  const { scenario } = await loadScenarioBySampleNumber("srj35", sampleNumber)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, {
    cacheProvider: null,
    effort: 0.01,
  })
  const inputGraphics = convertSrjToGraphicsObject(scenario)
  // Record the full-board preparation stages. Routing remains available in the
  // dataset fixture and run-sample CLI; this baseline does not claim a full solve.
  while (
    !solver.solved &&
    !solver.failed &&
    solver.getCurrentPhase() !== "topologyPlanningSolver"
  ) {
    solver.step()
  }
  const componentDetectionSolver = solver.componentDetectionSolver
  const netToPointPairsSolver = solver.netToPointPairsSolver
  if (!componentDetectionSolver || !netToPointPairsSolver) {
    throw new Error(
      `${boardName}: routing preparation did not reach point-pair generation: ${solver.error}`,
    )
  }
  expect({
    layerCount: scenario.layerCount,
    connections: scenario.connections.length,
    endpoints: scenario.connections.reduce(
      (total, connection) => total + connection.pointsToConnect.length,
      0,
    ),
    obstacles: scenario.obstacles.length,
    failed: solver.failed,
    error: solver.error,
    phase: solver.getCurrentPhase(),
    detectedComponents: componentDetectionSolver.getOutput().length,
    pointPairs: solver.srjWithPointPairs?.connections.length,
  }).toMatchSnapshot("full-board routing preparation")
  await expect(
    stackSvgsHorizontally(
      [
        inputGraphics,
        componentDetectionSolver.visualize(),
        netToPointPairsSolver.visualize(),
      ].map((graphics) =>
        getSvgFromGraphicsObject(graphics, {
          svgWidth: 800,
          svgHeight: 800,
          hideInlineLabels: true,
          backgroundColor: "white",
        }),
      ),
      {
        gap: 24,
        normalizeSize: false,
        rootAttributes: {
          "aria-label": `${boardName}: full-board input, detected components, routing point pairs`,
          role: "img",
        },
      },
    ),
  ).toMatchSvgSnapshot(testPath, { scale: 1 })
}
