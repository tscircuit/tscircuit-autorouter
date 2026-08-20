import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 fails when a routed connection exceeds maxViaCount", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [],
    connections: [
      {
        name: "XTAL_IN",
        maxViaCount: 0,
        pointsToConnect: [
          { x: 1, y: 1, layer: "top" },
          { x: 9, y: 9, layer: "top" },
        ],
      },
    ],
  })
  solver.pipelineDef = []
  solver.srjWithPointPairs = structuredClone(solver.srj)
  solver.getPrePowerTraceOutputSimplifiedPcbTraces = () => [
    {
      type: "pcb_trace",
      pcb_trace_id: "XTAL_IN_0",
      connection_name: "XTAL_IN",
      route: [
        { route_type: "wire", x: 1, y: 1, width: 0.15, layer: "top" },
        {
          route_type: "via",
          x: 5,
          y: 5,
          from_layer: "top",
          to_layer: "bottom",
        },
        { route_type: "wire", x: 9, y: 9, width: 0.15, layer: "bottom" },
      ],
    },
  ]

  solver.step()

  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toContain(
    'Connection "XTAL_IN" uses 1 vias, exceeding maxViaCount=0',
  )
})
