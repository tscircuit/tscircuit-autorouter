import type { SimpleRouteJson } from "lib/types"

type ViaDimensionInput = Pick<
  SimpleRouteJson,
  | "minViaDiameter"
  | "minViaHoleDiameter"
  | "minViaPadDiameter"
  | "min_via_hole_diameter"
  | "min_via_pad_diameter"
>

const firstFiniteNumber = (
  ...values: Array<number | undefined>
): number | undefined =>
  values.find((value) => typeof value === "number" && Number.isFinite(value))

export const getViaDimensions = (srj: ViaDimensionInput) => {
  const requestedHoleDiameter = firstFiniteNumber(
    srj.min_via_hole_diameter,
    srj.minViaHoleDiameter,
  )
  // Prefer the explicit pad-diameter fields; only fall back to the deprecated
  // legacy single-diameter field when no pad diameter was provided.
  const requestedPadDiameter = firstFiniteNumber(
    srj.min_via_pad_diameter,
    srj.minViaPadDiameter,
    srj.minViaDiameter,
  )
  const padDiameter = Math.max(
    requestedPadDiameter ?? srj.minViaDiameter ?? 0.3,
    requestedHoleDiameter ?? 0,
  )

  return {
    padDiameter,
    holeDiameter: requestedHoleDiameter ?? padDiameter * 0.5,
  }
}
