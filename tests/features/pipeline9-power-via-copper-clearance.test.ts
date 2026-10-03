import { expect, test } from "bun:test"
import {
  type PowerTraceExpanderInput,
  SpatialObstacleIndex,
} from "@tscircuit/power-trace-expander"
import type { SimplifiedPcbTrace } from "lib/types"

test("via copper spacing respects pad rules independently of drill and trace rules", (): void => {
  const input: PowerTraceExpanderInput = {
    layerCount: 2,
    minTraceWidth: 0.095,
    minTraceToPadEdgeClearance: 0.1,
    minPadEdgeToPadEdgeClearance: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.25,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [],
    obstacles: [],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "existing-via",
    connection_name: "signal",
    route: [
      {
        route_type: "via",
        x: 0,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
    ],
  }
  for (const fixed of [false, true]) {
    const index = new SpatialObstacleIndex(
      { ...input, fixedTraces: fixed ? [trace] : [] },
      fixed ? [] : [trace],
    )
    const query = {
      point: { x: 0.42, y: 0 },
      layers: ["top", "bottom"],
      padDiameter: 0.3,
      holeDiameter: 0.15,
      connectionNames: ["power"],
    }
    // The 0.27 mm drill gap passes; the 0.12 mm copper gap fails.
    expect(index.collidesVia(query)).toBe(true)
    expect(
      index.collidesVia({ ...query, point: { x: 0.450001, y: 0 } }),
    ).toBe(false)
    expect(
      index.collidesVia({ ...query, connectionNames: ["signal"] }),
    ).toBe(false)
    // Drill spacing still applies to connected copper.
    expect(
      index.collidesVia({
        ...query,
        point: { x: 0.39, y: 0 },
        connectionNames: ["signal"],
      }),
    ).toBe(true)
    expect(
      index.collides({
        start: query.point,
        end: query.point,
        layer: "top",
        width: 0.3,
        connectionNames: ["power"],
      }),
    ).toBe(false)
  }
})
