import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"

export function createPipeline7LengthInput(
  maxLength: number,
  plane = false,
): SimpleRouteJson {
  const input = {
    layerCount: plane ? 4 : 2,
    minTraceWidth: 0.15,
    boardThickness: 1.6,
    bounds: { minX: -5, maxX: 5, minY: -4, maxY: 4 },
    obstacles: plane
      ? [
          {
            type: "rect" as const,
            center: { x: 0, y: 0 },
            width: 9.6,
            height: 7.6,
            layers: ["inner1"],
            connectedTo: ["SIGNAL"],
            isCopperPour: true,
          },
        ]
      : [],
    connections: [
      {
        name: "SIGNAL",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pointId: "a", pcb_port_id: "a" },
          { x: 2, y: 0, layer: "top", pointId: "b", pcb_port_id: "b" },
        ],
      },
    ],
    routeConstraints: [
      {
        connectionName: "SIGNAL",
        sourceTraceId: "length_rule",
        name: plane ? "GND stitch" : "signal connection",
        pointIds: plane ? ["a"] : ["a", "b"],
        maxLength,
      },
    ],
  }
  return input
}

export function getPipeline7LengthSnapshot(
  input: SimpleRouteJson,
  pointPairs: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
  caption: string,
): string {
  const svg = getBugReportSnapshotSvg({
    inputSrj: input,
    srjWithPointPairs: pointPairs,
    routedTraces: traces,
  })
  const label = `<g><rect x="12" y="64" width="616" height="40" fill="white" stroke="#334155"/><text x="24" y="91" font-family="Arial, sans-serif" font-size="16" fill="#334155">${caption}</text></g>`
  return svg.replace("</svg>", `${label}</svg>`).replace(/[ \t]+$/gm, "")
}
