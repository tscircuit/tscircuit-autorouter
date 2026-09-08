import type { CircuitJson, PcbComponent } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types/srj-types"
import { parseSync } from "svgson"
import { applyToPoint, fromTriangles } from "transformation-matrix"

type BootRoutingPcbSvgInput = {
  circuitJson: CircuitJson
  srj: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
  routingCompleted: boolean
}

/** Draw actual component footprints and supplied native copper, never candidates. */
export const getT113BootRoutingPcbSvg = ({
  circuitJson,
  srj,
  traces,
  routingCompleted,
}: BootRoutingPcbSvgInput): string => {
  const board = circuitJson.find((element) => element.type === "pcb_board")
  const bootSource = circuitJson
    .filter((element) => element.type === "source_component")
    .find((element) => element.name === "R_BOOT_SEL1")
  const bootComponent = circuitJson.find(
    (element): element is PcbComponent =>
      element.type === "pcb_component" &&
      element.source_component_id === bootSource?.source_component_id,
  )
  if (
    !board ||
    board.width === undefined ||
    board.height === undefined ||
    !bootSource ||
    !bootComponent
  ) {
    throw new Error(
      "The PCB snapshot requires the real board and boot resistor",
    )
  }
  const nativeCopper = convertToCircuitJson(srj, traces).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  const placedCircuit = circuitJson.filter(
    (element) => element.type !== "pcb_trace" && element.type !== "pcb_via",
  )
  const nativeSvg = convertCircuitJsonToPcbSvg(
    [...placedCircuit, ...nativeCopper],
    {
      width: 860,
      height: 760,
      backgroundColor: "white",
      layer: "top",
      renderSolderMask: false,
      includeVersion: false,
      shouldDrawRatsNest: false,
      colorOverrides: {
        copper: { top: "#be123c" },
        silkscreen: { top: "#172033", bottom: "#172033" },
        boardOutline: "#475569",
        drill: "white",
      },
    },
  )
  const nativeRoot = parseSync(nativeSvg)
  const nativeBoundary = nativeRoot.children.find(
    (node) => node.attributes.class === "pcb-boundary",
  )
  if (!nativeBoundary) {
    throw new Error("The native PCB renderer did not emit its board boundary")
  }
  const boundaryX = Number(nativeBoundary.attributes.x)
  const boundaryY = Number(nativeBoundary.attributes.y)
  const boundaryWidth = Number(nativeBoundary.attributes.width)
  const boundaryHeight = Number(nativeBoundary.attributes.height)
  // Board space is millimetres, +X right / +Y up. Derive the SVG pixel frame
  // (+X right / +Y down) from the renderer's emitted boundary, not its internals.
  const boardToSvg = fromTriangles(
    [
      {
        x: board.center.x - board.width / 2,
        y: board.center.y + board.height / 2,
      },
      {
        x: board.center.x + board.width / 2,
        y: board.center.y + board.height / 2,
      },
      {
        x: board.center.x - board.width / 2,
        y: board.center.y - board.height / 2,
      },
    ],
    [
      { x: boundaryX, y: boundaryY },
      { x: boundaryX + boundaryWidth, y: boundaryY },
      { x: boundaryX, y: boundaryY + boundaryHeight },
    ],
  )
  const zoomTopLeft = applyToPoint(boardToSvg, {
    x: bootComponent.center.x - 2.6,
    y: bootComponent.center.y + 2.7,
  })
  const zoomBottomRight = applyToPoint(boardToSvg, {
    x: bootComponent.center.x + 2.6,
    y: bootComponent.center.y - 2.1,
  })
  const zoomViewBox = [
    zoomTopLeft.x,
    zoomTopLeft.y,
    zoomBottomRight.x - zoomTopLeft.x,
    zoomBottomRight.y - zoomTopLeft.y,
  ].join(" ")
  const nativeBody = nativeSvg.slice(
    nativeSvg.indexOf(">") + 1,
    nativeSvg.lastIndexOf("</svg>"),
  )
  const status = routingCompleted
    ? "Fixed: all five SD connections routed; boot ground rerouted"
    : "Baseline: boot routed; five SD connections remain unrouted"
  const statusColor = routingCompleted ? "#166534" : "#9a3412"
  const detail = routingCompleted
    ? "The native router moved the ground via and completed the SD routes."
    : "Only successful boot routing is shown; rejected candidate copper is not."

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="930" viewBox="0 0 1300 930">
<rect width="1300" height="930" fill="white"/>
<g font-family="Arial, sans-serif" fill="#172033">
<text x="28" y="38" font-size="25" font-weight="700">Pipeline 9 · real component routing</text>
<text x="28" y="73" font-size="20" fill="${statusColor}">${status}</text>
<text x="28" y="111" font-size="16" font-weight="700">PCB OVERVIEW · TOP VIEW</text>
<svg x="0" y="123" width="860" height="760" viewBox="0 0 860 760">${nativeBody}</svg>
<text x="886" y="152" font-size="18" font-weight="700">R_BOOT_SEL1 · GROUND VIA</text>
<rect x="875" y="173" width="400" height="420" fill="white" stroke="#cbd5e1"/>
<svg x="876" y="174" width="398" height="418" viewBox="${zoomViewBox}" overflow="hidden">${nativeBody}</svg>
<text x="886" y="628" font-size="16">Upper pad → PC5; lower pad → GND</text>
<text x="886" y="657" font-size="16">Red: actual top-layer copper</text>
<text x="886" y="686" font-size="16">White centre: actual drilled via</text>
<text x="28" y="891" font-size="16">T113-S3 + 3k3 boot resistor + five 0Ω SD links · native Pipeline9 and fanout</text>
<text x="28" y="919" font-size="16" fill="${statusColor}">${detail}</text>
</g>
</svg>`
}
