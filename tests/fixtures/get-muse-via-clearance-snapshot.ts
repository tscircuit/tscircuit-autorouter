import { getSvgFromGraphicsObject } from "graphics-debug"
import type { EvaluateRelaxedDrcInput } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { stackSvgsHorizontally } from "stack-svgs"

/** Same physical view for the captured original output and freshly solved fix. */
export function getMuseViaClearanceSnapshot(input: EvaluateRelaxedDrcInput): {
  svg: string
  copperGap: number
} {
  // Show the tightest actual different-net pair after routing changes.
  const vias = input.routedTraces.flatMap((trace) =>
    trace.route
      .filter((point) => point.route_type === "via")
      .map((via) => ({ ...via, connectionName: trace.connection_name })),
  )
  let pair: [(typeof vias)[number], (typeof vias)[number]] | undefined
  let copperGap = Infinity
  for (let i = 0; i < vias.length; i++) {
    for (let j = i + 1; j < vias.length; j++) {
      const a = vias[i]!
      const b = vias[j]!
      if (a.connectionName === b.connectionName) continue
      if (
        !a.via_diameter ||
        !b.via_diameter ||
        !a.via_hole_diameter ||
        !b.via_hole_diameter
      ) {
        throw new Error("Snapshot vias must declare copper and drill diameters")
      }
      const gap =
        Math.hypot(a.x - b.x, a.y - b.y) -
        (a.via_diameter + b.via_diameter) / 2
      if (gap < copperGap) {
        copperGap = gap
        pair = [a, b]
      }
    }
  }
  if (!pair) throw new Error("Snapshot requires vias on two different nets")
  const originalPair =
    pair[0].connectionName === "source_net_2" &&
    pair[1].connectionName === "source_net_1"
  const center = originalPair
    ? { x: 16.03, y: 10.76 }
    : {
        x: (pair[0].x + pair[1].x) / 2,
        y: (pair[0].y + pair[1].y) / 2,
      }
  const labels = originalPair
    ? ["BOOST_SW", "RESE"]
    : pair.map((via): string => via.connectionName)
  const minimum = input.inputSrj.minPadEdgeToPadEdgeClearance!
  const color = copperGap < minimum - 1e-9 ? "#b91c1c" : "#166534"
  const focus = getSvgFromGraphicsObject(
    {
      rects: [
        {
          center,
          width: 2,
          height: 2,
          fill: "#ffffff",
        },
      ],
      circles: [
        ...pair.map((via) => ({
          center: via,
          radius: via.via_diameter! / 2 + minimum / 2,
          fill: copperGap < minimum - 1e-9 ? "#b91c1c28" : "#16653428",
          stroke: color,
        })),
        ...pair.map((via, index) => ({
          center: via,
          radius: via.via_diameter! / 2,
          fill: "blue",
          label: labels[index],
        })),
        ...pair.map((via) => ({
          center: via,
          radius: via.via_hole_diameter! / 2,
          fill: "white",
        })),
      ],
      texts: [
        {
          x: center.x,
          y: center.y + 0.79,
          text: `${labels[0]} (upper)`,
          fontSize: 0.1,
          anchorSide: "center",
        },
        {
          x: center.x,
          y: center.y - 0.79,
          text: `${labels[1]} (lower)`,
          fontSize: 0.1,
          anchorSide: "center",
        },
      ],
    },
    { backgroundColor: "white", svgWidth: 800, svgHeight: 800 },
  ).replace(
    "</svg>",
    `<g><rect x="12" y="12" width="776" height="80" fill="white"/><text x="24" y="42" font-family="Arial, sans-serif" font-size="22" fill="${color}">Copper gap: ${copperGap.toFixed(6)} mm / ${minimum.toFixed(6)} mm required</text><text x="24" y="74" font-family="Arial, sans-serif" font-size="18" fill="#334155">0.5 mm copper / 0.3 mm drill; rings add half the minimum gap</text></g></svg>`,
  )
  return {
    svg: stackSvgsHorizontally([getBugReportSnapshotSvg(input), focus], {
      gap: 12,
      normalizeSize: false,
    }).replace(/[ \t]+$/gm, ""),
    copperGap,
  }
}
