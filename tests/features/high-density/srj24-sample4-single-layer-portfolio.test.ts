import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { mergeGraphics } from "graphics-debug"
import { SingleLayerNoDifferentRootIntersectionsIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { srj24Sample4SingleLayerNode } from "./fixtures/srj24-sample4-single-layer-node.fixture"

test("visualizes the srj24 sample 4 single-layer portfolio rejection", async () => {
  const inputSolver = new SingleLayerNoDifferentRootIntersectionsIntraNodeSolver(
    {
      nodeWithPortPoints: srj24Sample4SingleLayerNode,
      traceWidth: 0.1,
      viaDiameter: 0.3,
    },
  )
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: srj24Sample4SingleLayerNode,
    connMap: new ConnectivityMap({}),
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 6,
    effort: 1,
  })

  while (!portfolio.solved && !portfolio.failed) portfolio.step()

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Production input: 5 route pairs on z0",
        step: 0,
        graphics: inputSolver.visualize(),
      },
      {
        name: portfolio.solved
          ? "Portfolio result: single-layer routes"
          : "Issue: single-layer solver rejected",
        step: portfolio.iterations,
        graphics: mergeGraphics(
          inputSolver.visualize(),
          portfolio.visualize(),
        ),
      },
    ],
    columns: 2,
    cellWidth: 2.2,
    cellHeight: 3.2,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 3 })
})
