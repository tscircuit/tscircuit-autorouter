import type { ConnectionPoint } from "lib/types"
import { getPointKey } from "./getPointKey"

export const getConnectionPointPairKey = (
  pointA: ConnectionPoint,
  pointB: ConnectionPoint,
): string => JSON.stringify([getPointKey(pointA), getPointKey(pointB)].sort())
