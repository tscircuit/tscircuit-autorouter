import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import type { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("Glider DDR ADDR6 escape via", async (): Promise<void> => {
  // Actual Glider node at entry to force improvement, reduced to its escape via.
  const x = -18.800000000000004
  const y = -11.900000000000006
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "topology_merge_4309",
    center: { x: -18.5, y },
    width: 0.600000000000005,
    height: 0.6000000000000014,
    availableZ: [0, 1, 2, 3],
    portPoints: [0, 1].map((z) => ({
      x,
      y,
      z,
      connectionName: "source_trace_11",
    })),
  }
  const route: HighDensityRoute = {
    connectionName: "source_trace_11",
    regionId: node.capacityMeshNodeId,
    traceThickness: 0.15,
    viaDiameter: 0.45,
    route: node.portPoints.flatMap(({ x, y, z }) => [
      { x, y, z },
      { x, y, z },
    ]),
    vias: [{ x, y }],
  }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph({
    layerCount: 4,
    minTraceWidth: 0.15,
    bounds: { minX: -45, maxX: 45, minY: -40, maxY: 40 },
    obstacles: [],
    connections: [],
  })
  pipeline.highDensityNodePortPoints = [node]
  pipeline.highDensityRouteSolver = {
    routes: [route],
  } as Pipeline9HighDensitySolver
  const step = pipeline.pipelineDef.find(
    (entry) => entry.solverName === "highDensityForceImproveSolver",
  )!
  const [params] = step.getConstructorParams(pipeline) as ConstructorParameters<
    typeof Pipeline9HighDensityForceImproveSolver
  >
  const solver = new Pipeline9HighDensityForceImproveSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  const graphics = solver.visualize()
  graphics.rects = [
    {
      center: node.center,
      width: node.width,
      height: node.height,
      stroke: "#94a3b8",
    },
  ]
  graphics.points = [
    { x, y, color: "#b91c1c", label: "fixed top / inner1 ports" },
  ]
  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
})
