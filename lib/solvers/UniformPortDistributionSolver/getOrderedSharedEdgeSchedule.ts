import type { EdgeInterval } from "./getSharedEdgePhysicalIntervals"

export type OrderedSharedEdgePort = {
  owner: string | undefined
  connectionName: string
  width: number
  allowed: readonly EdgeInterval[]
}

export type OrderedSharedEdgeScheduleInput = {
  length: number
  ports: readonly OrderedSharedEdgePort[]
  traceClearance: number
  tolerance: number
  /** A lower-bound width used only for conservative global feasibility proofs. */
  minimumProofWidth?: number
  /** Widens proof domains and reduces required pitch; placement leaves this zero. */
  proofSlack?: number
}

export type OrderedSharedEdgeSchedule =
  | {
      feasible: true
      latest: number[]
      gaps: number[][]
    }
  | {
      feasible: false
      failedIndex: number
      latest: (number | undefined)[]
      gaps: number[][]
    }

/**
 * Tests the supplied order without reordering ports or selecting new XY points.
 * All earlier/later foreign-owner pairs constrain pitch, including pairs with a
 * narrower same-owner port between them. Greedily taking each latest legal
 * position backwards maximizes the space available to every earlier port.
 */
export function getOrderedSharedEdgeSchedule({
  length,
  ports,
  traceClearance,
  tolerance,
  minimumProofWidth,
  proofSlack = 0,
}: OrderedSharedEdgeScheduleInput): OrderedSharedEdgeSchedule {
  if (
    !Number.isFinite(length) ||
    length < 0 ||
    !Number.isFinite(traceClearance) ||
    traceClearance < 0 ||
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    !Number.isFinite(proofSlack) ||
    proofSlack < 0 ||
    (minimumProofWidth !== undefined &&
      (!Number.isFinite(minimumProofWidth) || minimumProofWidth <= 0))
  )
    throw new Error("Invalid ordered shared-edge scheduling rules")
  const domains = ports.map((port) => {
    if (!Number.isFinite(port.width) || port.width <= 0)
      throw new Error("Invalid ordered shared-edge trace width")
    return port.allowed.flatMap(([low, high]): EdgeInterval[] => {
      if (!Number.isFinite(low) || !Number.isFinite(high) || low > high)
        throw new Error("Invalid ordered shared-edge interval")
      const start = Math.max(0, low - proofSlack)
      const end = Math.min(length, high + proofSlack)
      return start <= end ? [[start, end]] : []
    })
  })
  const widths = ports.map((port) =>
    minimumProofWidth === undefined
      ? port.width
      : Math.min(port.width, minimumProofWidth),
  )
  const gaps = ports.map((port, i) =>
    ports.map((other, j) => {
      const sameOwner = port.owner !== undefined && port.owner === other.owner
      return i === j ||
        sameOwner ||
        port.connectionName === other.connectionName
        ? 0
        : Math.max(
            0,
            (widths[i]! + widths[j]!) / 2 +
              traceClearance -
              tolerance -
              proofSlack,
          )
    }),
  )
  const latest: (number | undefined)[] = new Array(ports.length).fill(undefined)
  for (let i = ports.length - 1; i >= 0; i--) {
    let maximum = length
    for (let j = i + 1; j < ports.length; j++)
      maximum = Math.min(maximum, latest[j]! - gaps[i]![j]!)
    let position: number | undefined
    for (const [low, high] of domains[i]!) {
      const candidate = Math.min(high, maximum)
      if (candidate >= low && (position === undefined || candidate > position))
        position = candidate
    }
    if (position === undefined)
      return { feasible: false, failedIndex: i, latest, gaps }
    latest[i] = position
  }
  return { feasible: true, latest: latest as number[], gaps }
}
