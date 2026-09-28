import { expect, test } from "bun:test"
import { prepareSpineTerminals } from "../../scripts/differential-pair-portfolio/prepareSpineTerminals"
import { parseSimplifiedPcbTrace } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/model/parseSimplifiedPcbTrace"

test("rejects terminal escape copper crossing a foreign pad", (): void => {
  const traces = [0, 1].map((i) =>
    parseSimplifiedPcbTrace(
      {
        type: "pcb_trace",
        pcb_trace_id: `t${i}`,
        connection_name: `net${i}`,
        route: [
          { route_type: "wire", x: 0, y: i, width: 0.1, layer: "top" },
          { route_type: "wire", x: 10, y: i, width: 0.1, layer: "top" },
        ],
      },
      2,
    ),
  )
  const result = prepareSpineTerminals({
    first: traces[0]!,
    second: traces[1]!,
    reverseSecond: false,
    context: {
      immutableTraces: [],
      obstacles: [
        {
          type: "rect",
          center: { x: 0.15, y: 0.5 },
          width: 0.2,
          height: 1.5,
          layers: ["top"],
          connectedTo: ["unrelated-pad"],
        },
      ],
      bounds: { minX: -1, maxX: 11, minY: -1, maxY: 2 },
      layerCount: 2,
    },
    centerlineSpacing: 0.3,
    maxUncoupledLength: 1,
  })
  expect(result.status).toBe("rejected")
})
