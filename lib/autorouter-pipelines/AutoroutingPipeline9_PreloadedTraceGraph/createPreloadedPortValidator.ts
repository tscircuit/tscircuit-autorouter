import type { PortPoint } from "lib/types/high-density-types"
import {
  createPreloadedCopperLookup,
  type PreloadedCopperInput,
} from "./createPreloadedCopperLookup"
import { arePipeline9RoutesOnSameNet } from "./pipeline9FixedRouteCopper"

type PortValidator = (
  point: PortPoint,
  options?: { includeClearance?: boolean },
) => boolean

/** Validate crossings against preloaded wire and via copper. */
export function createPreloadedPortValidator(
  input: PreloadedCopperInput,
): PortValidator {
  const { getBlockers } = createPreloadedCopperLookup(input)
  return (point, options): boolean =>
    getBlockers(point, options).every((route) =>
      arePipeline9RoutesOnSameNet({ left: point, right: route }, input.connMap),
    )
}
