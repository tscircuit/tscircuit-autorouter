import { expect, test } from "bun:test"
import { assertBusAllowedLayers } from "../fixtures/assertBusAllowedLayers"
import {
  createBusLayerInput,
  createBusLayerTrace,
} from "../fixtures/bus-layer-input"

test("bus layer checks resolve root aliases and intersect overlapping bus restrictions", (): void => {
  const srj = createBusLayerInput()
  srj.connections[0]!.__netConnectionName = "DATA_NET"
  const trace = createBusLayerTrace("inner2")
  trace.connection_name = "DATA_NET"
  trace.connectsTo = []
  expect(() => assertBusAllowedLayers(srj, [trace])).not.toThrow()
  srj.buses!.push({
    busId: "package-escape",
    name: "Package escape",
    connectionNames: ["DDR_D0"],
    allowedLayers: ["top", "bottom"],
  })
  expect(() => assertBusAllowedLayers(srj, [trace])).toThrow(
    'Bus "Package escape" connection "DDR_D0" uses prohibited routing layer "inner2"',
  )
  const mergedBranch = createBusLayerTrace("inner1")
  mergedBranch.connection_name = "merged_mst0"
  // Output branches retain original endpoint identities after net merging.
  expect(() => assertBusAllowedLayers(srj, [mergedBranch])).toThrow(
    'Bus "DDR byte 0" connection "DDR_D0" uses prohibited routing layer "inner1"',
  )
})
