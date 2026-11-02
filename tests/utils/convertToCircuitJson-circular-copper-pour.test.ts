import { expect, test } from "bun:test"
import { getPourPolygon } from "@tscircuit/circuit-json-util"
import type { SimpleRouteJson } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"

test("circular retained copper pours preserve their exact curved geometry", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    layerCount: 2,
    minTraceWidth: 0.15,
    connections: [],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        layers: ["bottom"],
        connectedTo: [],
        isCopperPour: true,
      },
    ],
  }
  const pours = convertToCircuitJson(srj, []).filter(
    (element) => element.type === "pcb_copper_pour",
  )
  expect(pours).toHaveLength(1)
  const polygon = getPourPolygon(pours[0]!)
  expect(polygon.area()).toBeCloseTo(Math.PI, 12)
  expect(polygon.box).toMatchObject({ xmin: -1, xmax: 1, ymin: -1, ymax: 1 })
})
