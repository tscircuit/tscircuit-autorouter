import { expect, test } from "bun:test"
import { getPhysicalViaRegionPortConflicts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getPhysicalViaRegionPortConflicts"

test("physical via regions index nearby ports independently of their layers", (): void => {
  const result = getPhysicalViaRegionPortConflicts(
    {
      portX: [0.2, 1],
      portY: [0, 0],
      regionCenterX: [0, 1],
      regionCenterY: [0, 0],
      regionWidth: [0.2032, 0.2032],
      regionHeight: [0.2032, 0.2032],
      regionMetadata: [{ isLayerTransition: true }, {}],
    },
    0.1524,
    0.1,
  )
  expect(result.portsByRegion).toEqual([[0], []])
  expect(result.regionsByPort).toEqual([[0], []])
})
