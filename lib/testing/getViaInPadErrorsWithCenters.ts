import { checkViasInPads } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbPlacementError, PcbVia } from "circuit-json"

type ViaInPadErrorWithCenter = PcbPlacementError & {
  center: { x: number; y: number }
}

/** Preserve checker errors and explicit centers without parsing opaque IDs. */
export const getViaInPadErrorsWithCenters = (
  circuitJson: AnyCircuitElement[],
): ViaInPadErrorWithCenter[] => {
  if (checkViasInPads(circuitJson).length === 0) return []
  const nonViaElements = circuitJson.filter(
    (element): boolean => element.type !== "pcb_via",
  )
  const vias = circuitJson.filter(
    (element): element is PcbVia => element.type === "pcb_via",
  )
  const errors: ViaInPadErrorWithCenter[] = []
  const collect = (
    start: number,
    end: number,
    knownToContainError: boolean,
  ): void => {
    if (end - start <= 8) {
      for (let index = start; index < end; index++) {
        const via = vias[index]!
        for (const error of checkViasInPads([...nonViaElements, via])) {
          errors.push({ ...error, center: { x: via.x, y: via.y } })
        }
      }
      return
    }
    // Via placement depends only on each via and the fixed pad context.
    // Prune clean groups, then visit the original via order. Singleton checks
    // retain checker pad ordering, names and repeated IDs exactly.
    if (
      !knownToContainError &&
      checkViasInPads([...nonViaElements, ...vias.slice(start, end)]).length ===
        0
    )
      return
    const middle = start + Math.floor((end - start) / 2)
    collect(start, middle, false)
    collect(middle, end, false)
  }
  collect(0, vias.length, true)
  return errors
}
