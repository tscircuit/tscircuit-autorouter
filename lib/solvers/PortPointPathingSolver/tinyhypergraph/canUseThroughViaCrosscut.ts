import { minimumPortfolioBoundaryPadding } from "lib/solvers/HyperHighDensitySolver/minimumPortfolioBoundaryPadding"
import type { SimpleRouteJson } from "lib/types"

type Input = {
  originalSrj: SimpleRouteJson
  planningSrj: SimpleRouteJson
  viaDiameter: number
  minTraceWidth: number
}

/** Certify the fresh, through-only portfolio policy needed by the local proof. */
export function canUseThroughViaCrosscut({
  originalSrj,
  planningSrj,
  viaDiameter,
  minTraceWidth,
}: Input): boolean {
  return (
    !originalSrj.allowBlindAndBuriedVias &&
    !planningSrj.allowBlindAndBuriedVias &&
    planningSrj.layerCount >= 2 &&
    !originalSrj.traces?.length &&
    !planningSrj.traces?.length &&
    !originalSrj.jumpers?.length &&
    !planningSrj.jumpers?.length &&
    !originalSrj.allowJumpers &&
    !planningSrj.allowJumpers &&
    Number.isFinite(viaDiameter) &&
    Number.isFinite(minTraceWidth) &&
    viaDiameter / 2 + minimumPortfolioBoundaryPadding >= 0 &&
    minTraceWidth / 2 + minimumPortfolioBoundaryPadding >= 0
  )
}
