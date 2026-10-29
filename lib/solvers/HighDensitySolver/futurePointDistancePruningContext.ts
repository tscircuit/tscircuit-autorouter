import type { FutureConnection } from "./SingleHighDensityRouteSolver"

const FUTURE_POINT_DISTANCE_PRUNING_COUNTER_KEYS = ["instances", "contextsPruned"] as const

export type FuturePointDistancePruningStats = Record<
  (typeof FUTURE_POINT_DISTANCE_PRUNING_COUNTER_KEYS)[number], number
>

const ownedConstructionOptions = new WeakMap<object, {
  futures: FutureConnection[]
  stats: FuturePointDistancePruningStats
}>()

export const createFuturePointDistancePruningStats = (): FuturePointDistancePruningStats => {
  const stats = {} as FuturePointDistancePruningStats
  for (const key of FUTURE_POINT_DISTANCE_PRUNING_COUNTER_KEYS) {
    stats[key] = 0
  }
  return stats
}

/** Only unchanged internal options are admitted, once, for an owned lifetime. */
export const registerOwnedFuturePointDistancePruningOptions = <T extends {
  futureConnections?: FutureConnection[]
}>(opts: T, stats: FuturePointDistancePruningStats): T => {
  if (!opts.futureConnections) throw new Error("Owned future-point distance-pruning requires its concrete future list")
  ownedConstructionOptions.set(opts, { futures: opts.futureConnections, stats })
  return opts
}

export const consumeOwnedFuturePointDistancePruningOptions = (
  opts: object,
  futures: FutureConnection[],
): FuturePointDistancePruningStats | undefined => {
  const owned = ownedConstructionOptions.get(opts)
  ownedConstructionOptions.delete(opts)
  return owned?.futures === futures ? owned.stats : undefined
}

