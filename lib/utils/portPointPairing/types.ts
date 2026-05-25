import type { PortPoint } from "lib/types/high-density-types"

export type NodePortPointPair = {
  pairKey: string
  connectionName: string
  rootConnectionName?: string
  start: PortPoint
  end: PortPoint
}
