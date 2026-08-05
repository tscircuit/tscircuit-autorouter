import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { getPcbPortIdForRoute } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const ROUTE_ENDPOINT_PCB_PORT_IDS = ["pcb_port_954", "pcb_port_214"]
const VISITED_PORTAL_PCB_PORT_ID = "pcb_port_494"

function createTerminalOwnershipGraphics({
  emittedPcbPortId,
}: {
  emittedPcbPortId: string | undefined
}): GraphicsObject {
  const emittedValue = emittedPcbPortId ?? "none"
  return {
    rects: [
      {
        center: { x: 3, y: 1.5 },
        width: 6,
        height: 3,
        fill: "#f8fafc",
        stroke: "#64748b",
        label: "route terminal ownership",
      },
    ],
    texts: [
      {
        x: 0.25,
        y: 2.55,
        text: `Current route endpoints: ${ROUTE_ENDPOINT_PCB_PORT_IDS.join(", ")}`,
        fontSize: 0.24,
        color: "#0f172a",
        anchorSide: "bottom_left",
      },
      {
        x: 0.25,
        y: 1.55,
        text: `Visited same-net portal: ${VISITED_PORTAL_PCB_PORT_ID}`,
        fontSize: 0.24,
        color: "#0f172a",
        anchorSide: "bottom_left",
      },
      {
        x: 0.25,
        y: 0.55,
        text: `Emitted pcb_port_id: ${emittedValue}`,
        fontSize: 0.24,
        color: emittedPcbPortId ? "#dc2626" : "#15803d",
        anchorSide: "bottom_left",
      },
    ],
  }
}

test("visualizes terminal ownership for a routed connection", async (): Promise<void> => {
  const emittedPcbPortId = getPcbPortIdForRoute({
    portalPcbPortId: VISITED_PORTAL_PCB_PORT_ID,
    routeEndpointPcbPortIds: ROUTE_ENDPOINT_PCB_PORT_IDS,
  })

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: emittedPcbPortId
            ? "Issue: foreign same-net terminal is emitted"
            : "Fix: foreign same-net portal stays internal",
          graphics: createTerminalOwnershipGraphics({ emittedPcbPortId }),
        },
      ],
      columns: 1,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
