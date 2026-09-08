import type { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import type { FixedCopperClearanceInterval } from "./getFixedCopperClearanceIntervals"

export type RepresentableFixedCopperClearanceChannelInput = {
  /** Absolute X or Y coordinates, not distances to translate after placement. */
  readonly interval: Readonly<FixedCopperClearanceInterval>
  readonly axis: "x" | "y"
  readonly fixedCoordinate: number
  readonly z: number
  readonly selectedCoordinate: number
  readonly canonicalNetId: string
  readonly copperDiameter: number
  readonly clearanceIndex: FixedCopperClearanceIndex
}

const signBit = 0x8000000000000000n
const allBits = 0xffffffffffffffffn
const floatView = new DataView(new ArrayBuffer(8))

const getOrderedFloatKey = (coordinate: number): bigint => {
  floatView.setFloat64(0, coordinate)
  const bits = floatView.getBigUint64(0)
  const sign = bits & signBit
  if (sign !== 0n) return bits ^ allBits
  return bits ^ signBit
}

const getCoordinateFromOrderedKey = (key: bigint): number => {
  const sign = key & signBit
  const bits = sign === 0n ? key ^ allBits : key ^ signBit
  floatView.setBigUint64(0, bits)
  const coordinate = floatView.getFloat64(0)
  return coordinate
}

const isCoordinateClear = (
  params: RepresentableFixedCopperClearanceChannelInput,
  coordinate: number,
): boolean => {
  return params.clearanceIndex.isPointClear({
    point: {
      x: params.axis === "x" ? coordinate : params.fixedCoordinate,
      y: params.axis === "y" ? coordinate : params.fixedCoordinate,
      z: params.z,
    },
    canonicalNetId: params.canonicalNetId,
    copperDiameter: params.copperDiameter,
  })
}

const refineEndpointTowardWitness = (
  params: RepresentableFixedCopperClearanceChannelInput,
  endpoint: number,
): number => {
  if (
    endpoint === params.selectedCoordinate ||
    isCoordinateClear(params, endpoint)
  ) {
    return endpoint
  }
  let blockedKey = getOrderedFloatKey(endpoint)
  let clearKey = getOrderedFloatKey(params.selectedCoordinate)
  // These are ordered 64-bit integer keys. Each midpoint halves the bracket,
  // so at most 64 predicate evaluations leave adjacent representable values.
  for (let bit = 0; bit < 64; bit++) {
    const span =
      blockedKey > clearKey ? blockedKey - clearKey : clearKey - blockedKey
    if (span <= 1n) break
    const middleKey = (blockedKey + clearKey) / 2n
    const coordinate = getCoordinateFromOrderedKey(middleKey)
    if (isCoordinateClear(params, coordinate)) {
      clearKey = middleKey
    } else {
      blockedKey = middleKey
    }
  }
  const remainingSpan =
    blockedKey > clearKey ? blockedKey - clearKey : clearKey - blockedKey
  if (remainingSpan > 1n) {
    throw new Error(
      "getRepresentableFixedCopperClearanceChannel did not resolve its binary64 bracket",
    )
  }
  return getCoordinateFromOrderedKey(clearKey)
}

/**
 * Certifies the endpoints of one analytic channel against the actual world-
 * coordinate predicate, retaining its already selected legal witness. Clear
 * endpoints and exact singleton channels are not moved.
 *
 * Without a monotonicity proof for the floating-point predicate, the refined
 * endpoint is not claimed to be globally nearest, nor does endpoint clearance
 * certify every interior value. The caller must still validate its chosen port.
 */
export const getRepresentableFixedCopperClearanceChannel = (
  params: RepresentableFixedCopperClearanceChannelInput,
): FixedCopperClearanceInterval => {
  if (
    !Number.isFinite(params.interval.start) ||
    !Number.isFinite(params.interval.end) ||
    !Number.isFinite(params.selectedCoordinate) ||
    !Number.isFinite(params.fixedCoordinate) ||
    (params.axis !== "x" && params.axis !== "y") ||
    params.interval.start > params.interval.end ||
    params.selectedCoordinate < params.interval.start ||
    params.selectedCoordinate > params.interval.end
  ) {
    throw new Error(
      "getRepresentableFixedCopperClearanceChannel requires a finite channel containing its selected witness",
    )
  }
  if (!isCoordinateClear(params, params.selectedCoordinate)) {
    throw new Error(
      "getRepresentableFixedCopperClearanceChannel requires a physically clear selected witness",
    )
  }
  const start = refineEndpointTowardWitness(params, params.interval.start)
  const end = refineEndpointTowardWitness(params, params.interval.end)
  if (
    start > params.selectedCoordinate ||
    end < params.selectedCoordinate ||
    start < params.interval.start ||
    end > params.interval.end
  ) {
    throw new Error(
      "getRepresentableFixedCopperClearanceChannel moved outside its selected analytic channel",
    )
  }
  return { start, end }
}
