import { getSvgFromGraphicsObject } from "graphics-debug"
import type { EvaluateRelaxedDrcInput } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { stackSvgsHorizontally } from "stack-svgs"

type PhysicalVia = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "via" }
> & {
  via_diameter: number
  via_hole_diameter: number
  connectionName: string
  netId: string
  physicalLayers: number[]
}

/** Same physical view for the captured original output and freshly solved fix. */
export function getMuseViaClearanceSnapshot(input: EvaluateRelaxedDrcInput): {
  svg: string
  copperGap: number
} {
  // Topology improvements can remove the reported vias. Show the smallest
  // actual different-net copper gap rather than requiring those vias to exist.
  const { layerCount, allowBlindAndBuriedVias } = input.inputSrj
  const connMap = getConnectivityMapFromSimpleRouteJson(input.srjWithPointPairs)
  const layerZ = (layer: string): number => {
    const z = mapLayerNameToZ(layer, layerCount)
    if (!Number.isInteger(z) || z < 0 || z >= layerCount) {
      throw new Error(`Physical via has invalid layer "${layer}"`)
    }
    return z
  }
  const vias: PhysicalVia[] = []
  for (const trace of input.routedTraces) {
    const netId = connMap.getNetConnectedToId(trace.connection_name)
    if (!netId) {
      throw new Error(`Missing copper owner for ${trace.connection_name}`)
    }
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const diameter = point.via_diameter
      const holeDiameter = point.via_hole_diameter
      if (
        typeof diameter !== "number" ||
        typeof holeDiameter !== "number" ||
        ![point.x, point.y, diameter, holeDiameter].every(Number.isFinite) ||
        diameter <= 0 ||
        holeDiameter <= 0 ||
        holeDiameter >= diameter
      ) {
        throw new Error(`Invalid physical via for ${trace.connection_name}`)
      }
      const fromZ = layerZ(point.from_layer)
      const toZ = layerZ(point.to_layer)
      const declaredLayers = point.layers?.map(layerZ)
      const physicalLayers = allowBlindAndBuriedVias
        ? (declaredLayers ??
          Array.from(
            { length: Math.abs(toZ - fromZ) + 1 },
            (_, offset): number => Math.min(fromZ, toZ) + offset,
          ))
        : Array.from({ length: layerCount }, (_, z): number => z)
      const uniqueLayers = new Set(physicalLayers)
      if (
        !uniqueLayers.has(fromZ) ||
        !uniqueLayers.has(toZ) ||
        uniqueLayers.size !==
          Math.max(...physicalLayers) - Math.min(...physicalLayers) + 1
      ) {
        throw new Error(`Invalid physical via span for ${trace.connection_name}`)
      }
      vias.push({
        ...point,
        via_diameter: diameter,
        via_hole_diameter: holeDiameter,
        connectionName: trace.connection_name,
        netId,
        physicalLayers,
      })
    }
  }
  let pair: [PhysicalVia, PhysicalVia] | undefined
  let copperGap = Number.POSITIVE_INFINITY
  for (let i = 0; i < vias.length; i++) {
    for (let j = i + 1; j < vias.length; j++) {
      const a = vias[i]!
      const b = vias[j]!
      if (
        a.netId === b.netId ||
        !a.physicalLayers.some((z): boolean => b.physicalLayers.includes(z))
      ) {
        continue
      }
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      // Use real annuli: a via entirely inside another drill void does not
      // touch its copper, even when their outer disks overlap.
      const gap = Math.max(
        distance - (a.via_diameter + b.via_diameter) / 2,
        a.via_hole_diameter / 2 - distance - b.via_diameter / 2,
        b.via_hole_diameter / 2 - distance - a.via_diameter / 2,
      )
      if (gap < copperGap) {
        pair = [a, b]
        copperGap = gap
      }
    }
  }
  if (!pair) throw new Error("Missing different-net physical via pair")
  const [a, b] = pair
  const minimum = input.inputSrj.minPadEdgeToPadEdgeClearance
  if (typeof minimum !== "number" || !Number.isFinite(minimum) || minimum < 0) {
    throw new Error("Missing physical copper clearance")
  }
  const focusCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const focusWidth = Math.max(
    2,
    Math.abs(a.x - b.x) + a.via_diameter + b.via_diameter + minimum * 2,
  )
  const focusHeight = Math.max(
    2,
    Math.abs(a.y - b.y) + a.via_diameter + b.via_diameter + minimum * 2,
  )
  const color = copperGap < minimum - 1e-9 ? "#b91c1c" : "#166534"
  const focus = getSvgFromGraphicsObject(
    {
      rects: [
        {
          center: focusCenter,
          width: focusWidth,
          height: focusHeight,
          fill: "#ffffff",
        },
      ],
      circles: [
        ...pair.map((via) => ({
          center: via,
          radius: via.via_diameter / 2 + minimum / 2,
          layer: `z${via.physicalLayers.join(",")}`,
          fill: copperGap < minimum - 1e-9 ? "#b91c1c28" : "#16653428",
          stroke: color,
        })),
        ...pair.map((via) => ({
          center: via,
          radius: via.via_diameter / 2,
          layer: `z${via.physicalLayers.join(",")}`,
          fill: "blue",
          label: via.connectionName,
        })),
        ...pair.map((via) => ({
          center: via,
          radius: via.via_hole_diameter / 2,
          layer: `z${via.physicalLayers.join(",")}`,
          fill: "white",
        })),
      ],
      texts: [
        {
          x: focusCenter.x,
          y: focusCenter.y + focusHeight * 0.4,
          text: a.connectionName,
          fontSize: 0.1,
          anchorSide: "center",
        },
        {
          x: focusCenter.x,
          y: focusCenter.y - focusHeight * 0.4,
          text: b.connectionName,
          fontSize: 0.1,
          anchorSide: "center",
        },
      ],
    },
    { backgroundColor: "white", svgWidth: 800, svgHeight: 800 },
  ).replace(
    "</svg>",
    `<g><rect x="12" y="12" width="776" height="80" fill="white"/><text x="24" y="42" font-family="Arial, sans-serif" font-size="22" fill="${color}">Copper gap: ${copperGap.toFixed(6)} mm / ${minimum.toFixed(6)} mm required</text><text x="24" y="74" font-family="Arial, sans-serif" font-size="18" fill="#334155">${a.via_diameter} / ${b.via_diameter} mm copper; ${a.via_hole_diameter} / ${b.via_hole_diameter} mm drill</text></g></svg>`,
  )
  return {
    svg: stackSvgsHorizontally([getBugReportSnapshotSvg(input), focus], {
      gap: 12,
      normalizeSize: false,
    }).replace(/[ \t]+$/gm, ""),
    copperGap,
  }
}
