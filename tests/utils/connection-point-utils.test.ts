import { expect, test } from "bun:test"
import type {
  ConnectionPoint,
  SingleLayerConnectionPoint,
  MultiLayerConnectionPoint,
} from "../../lib/types/srj-types"
import {
  getConnectionPointLayer,
  getConnectionPointLayers,
  isSingleLayerConnectionPoint,
  isMultiLayerConnectionPoint,
} from "../../lib/utils/connection-point-utils"
import { getPointKey } from "../../lib/utils/getPointKey"

type Assert<T extends true> = T
type MixedPoint = { x: number; y: number; layer: string; layers: string[] }
type RejectMixedSingle = Assert<MixedPoint extends SingleLayerConnectionPoint ? false : true>
type RejectMixedMulti = Assert<MixedPoint extends MultiLayerConnectionPoint ? false : true>
type RejectMixedUnion = Assert<MixedPoint extends ConnectionPoint ? false : true>

test("single-layer and multilayer points are exclusive and use consistent layer helpers", () => {
  const single: SingleLayerConnectionPoint = { x: 0, y: 0, layer: "top" }
  const multi: MultiLayerConnectionPoint = { x: 0, y: 0, layers: ["top", "bottom"] }
  expect(isSingleLayerConnectionPoint(single)).toBe(true)
  expect(isMultiLayerConnectionPoint(single)).toBe(false)
  expect(isSingleLayerConnectionPoint(multi)).toBe(false)
  expect(isMultiLayerConnectionPoint(multi)).toBe(true)
  expect(getConnectionPointLayers(single)).toEqual(["top"])
  expect(getConnectionPointLayers(multi)).toEqual(["top", "bottom"])
  expect(getConnectionPointLayer(single)).toBe("top")
  expect(getConnectionPointLayer(multi)).toBe("top")
  expect(getPointKey(multi)).toBe("0.0000,0.0000,bottom-top")
  expect(getConnectionPointLayer(multi)).toBe("top")

  // JSON inputs can bypass the static contract; do not silently choose a field.
  const mixed = { ...single, layers: ["bottom"] } as unknown as ConnectionPoint
  expect(isSingleLayerConnectionPoint(mixed)).toBe(false)
  expect(isMultiLayerConnectionPoint(mixed)).toBe(false)
  expect(() => getConnectionPointLayers(mixed)).toThrow("never both")
  expect(() => getConnectionPointLayer(mixed)).toThrow("never both")
  expect(() => getPointKey(mixed)).toThrow("never both")
})
