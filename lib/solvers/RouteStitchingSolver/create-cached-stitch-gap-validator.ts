import type { Point3 } from "@tscircuit/math-utils"
import type {
  FindValidStitchPath,
  IsValidStitchSegment,
} from "./SingleHighDensityRouteStitchSolver3"
import type { IsValidStitchGap } from "./routeStitchingEndpointHelpers"

type StitchGapCacheKey = string

type CachedStitchGapValidatorInput = {
  traceThickness: number
  isValidStitchSegment?: IsValidStitchSegment
  findValidStitchPath?: FindValidStitchPath
}

const getStitchGapCacheKey = ({
  connectionName,
  start,
  end,
}: {
  connectionName: string
  start: Point3
  end: Point3
}): StitchGapCacheKey => {
  const startKey = `${start.x},${start.y},${start.z}`
  const endKey = `${end.x},${end.y},${end.z}`
  const [firstPointKey, secondPointKey] =
    startKey.localeCompare(endKey) <= 0
      ? [startKey, endKey]
      : [endKey, startKey]
  return `${connectionName}:${firstPointKey}:${secondPointKey}`
}

export const createCachedStitchGapValidator = (
  validatorInput: CachedStitchGapValidatorInput,
): IsValidStitchGap => {
  const validityByGap = new Map<StitchGapCacheKey, boolean>()

  return (stitchGap): boolean => {
    const cacheKey = getStitchGapCacheKey(stitchGap)
    const cachedValidity = validityByGap.get(cacheKey)
    if (cachedValidity !== undefined) return cachedValidity
    if (!validatorInput.isValidStitchSegment) return true

    const request = {
      ...stitchGap,
      traceThickness: validatorInput.traceThickness,
    }
    const isValid =
      validatorInput.isValidStitchSegment(request) ||
      Boolean(validatorInput.findValidStitchPath?.(request))
    validityByGap.set(cacheKey, isValid)
    return isValid
  }
}
