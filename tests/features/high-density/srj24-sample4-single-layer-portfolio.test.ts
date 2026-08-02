import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { mergeGraphics } from "graphics-debug"
import { SingleLayerNoDifferentRootIntersectionsIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { srj24Sample4SingleLayerNode } from "./fixtures/srj24-sample4-single-layer-node.fixture"

test("visualizes srj24 sample 4 duplicated single-layer ports", async () => {
  const traceWidth = 0.1
  const traceClearance = 0.1
  const routePairCount =
    srj24Sample4SingleLayerNode.portPointsInPairs?.length ?? 0
  const inputSolver = new SingleLayerNoDifferentRootIntersectionsIntraNodeSolver(
    {
      nodeWithPortPoints: srj24Sample4SingleLayerNode,
      traceWidth,
      traceClearance,
      viaDiameter: 0.3,
    },
  )
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: srj24Sample4SingleLayerNode,
    connMap: new ConnectivityMap({}),
    traceWidth,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 6,
    effort: 1,
  })

  while (!portfolio.solved && !portfolio.failed) portfolio.step()

  const physicalPortSpacing = {
    lines: [],
    points: [],
    rects: [],
    circles: srj24Sample4SingleLayerNode.portPoints.map((point) => ({
      center: { x: point.x, y: point.y },
      radius: (traceWidth + traceClearance) / 2,
      fill: "rgba(245, 158, 11, 0.18)",
      stroke: "rgba(217, 119, 6, 0.7)",
      label: `${point.connectionName}\nrequired center spacing: ${traceWidth + traceClearance} mm`,
    })),
  }

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: `Exact input: ${routePairCount} z0 pairs (blue ports)`,
        step: 0,
        graphics: mergeGraphics(
          physicalPortSpacing,
          inputSolver.visualize(),
        ),
      },
      {
        name: portfolio.solved
          ? `Result: ${portfolio.solvedRoutes.length}/${routePairCount} clearance-safe routes`
          : `Rejected: ${routePairCount} routes do not physically fit`,
        step: portfolio.iterations,
        graphics: mergeGraphics(
          physicalPortSpacing,
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
