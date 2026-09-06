import type { GetDrcErrorsOptions } from "./getDrcErrors"
import { MIN_VIA_TO_VIA_CLEARANCE } from "./getDrcErrors"

export const RELAXED_TRACE_CLEARANCE = 0.1

export const RELAXED_DRC_OPTIONS: GetDrcErrorsOptions = {
  traceClearance: RELAXED_TRACE_CLEARANCE,
  viaClearance: MIN_VIA_TO_VIA_CLEARANCE,
}
