import type { GetDrcErrorsOptions } from "lib/types/drc-types"

export const MIN_VIA_TO_VIA_CLEARANCE = 0.1
export const PREFERRED_VIA_TO_VIA_CLEARANCE = 0.2

export const RELAXED_DRC_OPTIONS = {
  traceClearance: 0.1,
  viaClearance: MIN_VIA_TO_VIA_CLEARANCE,
} satisfies GetDrcErrorsOptions
