import type { GetDrcErrorsOptions } from "./getDrcErrors"
import { MIN_VIA_TO_VIA_CLEARANCE } from "./getDrcErrors"

export const RELAXED_DRC_OPTIONS: GetDrcErrorsOptions = {
  traceClearance: 0.1,
  viaClearance: MIN_VIA_TO_VIA_CLEARANCE,
}
