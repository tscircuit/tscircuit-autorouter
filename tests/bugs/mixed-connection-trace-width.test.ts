import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { ConnectionPoint, SimpleRouteJson } from "lib/types"

test("routes a supply and sense connection sharing a pad", async (): Promise<void> => {
  const sense: ConnectionPoint = {
    x: 5,
    y: 0,
    layer: "top",
    pointId: "pcb_port_sense",
    pcb_port_id: "pcb_port_sense",
  }
  const junction: ConnectionPoint = {
    x: 0,
    y: 0,
    layer: "top",
    pointId: "pcb_port_junction",
    pcb_port_id: "pcb_port_junction",
  }
  const supply: ConnectionPoint = {
    x: -5,
    y: 0,
    layer: "top",
    pointId: "pcb_port_supply",
    pcb_port_id: "pcb_port_supply",
  }
  const inputSrj: SimpleRouteJson = {
    bounds: { minX: -7, maxX: 7, minY: -3, maxY: 3 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    obstacles: [sense, junction, supply].map(({ x, y, pcb_port_id }) => ({
      type: "rect",
      center: { x, y },
      width: 1,
      height: 1,
      layers: ["top"],
      connectedTo: [pcb_port_id!],
    })),
    connections: [
      {
        name: "sense",
        nominalTraceWidth: 0.15,
        pointsToConnect: [sense, junction],
      },
      {
        name: "supply",
        nominalTraceWidth: 0.8,
        pointsToConnect: [supply, junction],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(inputSrj),
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  for (const [point, width] of [
    [sense, 0.15],
    [supply, 0.8],
  ] as const) {
    const trace = routedTraces.find((trace) =>
      trace.connectsTo?.includes(point.pcb_port_id!),
    )
    expect(trace?.nominalTraceWidth).toBe(width)
    const wireWidths = trace!.route.flatMap((point) =>
      point.route_type === "wire" ? [point.width] : [],
    )
    expect(new Set(wireWidths)).toEqual(new Set([width]))
  }

  const drcInput = {
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  expect(evaluateRelaxedDrc(drcInput).errors).toEqual([])
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
