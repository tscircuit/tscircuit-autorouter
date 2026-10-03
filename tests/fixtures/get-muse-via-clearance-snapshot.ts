import { getSvgFromGraphicsObject } from "graphics-debug"
import type { EvaluateRelaxedDrcInput } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { stackSvgsHorizontally } from "stack-svgs"

/** Same physical view for the captured original output and freshly solved fix. */
export function getMuseViaClearanceSnapshot(input: EvaluateRelaxedDrcInput): {
  svg: string
  copperGap: number
} {
  // These locations select the reported pair for visualization only.
  // Neither the solver nor the clearance assertions use this selection.
  const targets = [
    { net: "source_net_2", x: 16.147295435728953, y: 11.046851707207189 },
    { net: "source_net_1", x: 15.911643654309586, y: 10.456754126462537 },
  ]
  const pair = targets.map((target) => {
    const via = input.routedTraces
      .filter((trace) => trace.connection_name === target.net)
      .flatMap((trace) => trace.route)
      .filter((point) => point.route_type === "via")
      .sort(
        (a, b) =>
          Math.hypot(a.x - target.x, a.y - target.y) -
          Math.hypot(b.x - target.x, b.y - target.y),
      )[0]
    if (!via || !via.via_diameter || !via.via_hole_diameter) {
      throw new Error(`Missing physical via for ${target.net}`)
    }
    return via
  })
  const [a, b] = pair
  const minimum = input.inputSrj.minPadEdgeToPadEdgeClearance!
  const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
  const copperGap = distance - (a!.via_diameter! + b!.via_diameter!) / 2
  const color = copperGap < minimum - 1e-9 ? "#b91c1c" : "#166534"
  const focus = getSvgFromGraphicsObject(
    {
      rects: [
        {
          center: { x: 16.03, y: 10.76 },
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
          label: index === 0 ? "BOOST_SW" : "RESE",
        })),
        ...pair.map((via) => ({
          center: via,
          radius: via.via_hole_diameter! / 2,
          fill: "white",
        })),
      ],
      texts: [
        {
          x: 16.03,
          y: 11.55,
          text: "BOOST_SW (upper)",
          fontSize: 0.1,
          anchorSide: "center",
        },
        {
          x: 16.03,
          y: 9.97,
          text: "RESE (lower)",
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
