import type { SimpleRouteConnection } from "lib/types"
import type { BgaRoutingGrid } from "./BgaRoutingGrid"
import type { EscapedTerminal, TerminalPair } from "./getEscapedTraceRoute"

type PairingInput = {
  terminals: EscapedTerminal[]
  pointPairs: SimpleRouteConnection[]
}

/** Orient the given point pairs away from their first terminal, shortest available branch first. */
export function getEscapedTerminalPairs(
  { terminals, pointPairs }: PairingInput,
  grid: BgaRoutingGrid,
): TerminalPair[] | undefined {
  if (!terminals.length || pointPairs.length !== terminals.length - 1) return
  const pairByTerminal = new Map<string, Map<string, string>>()
  for (const pair of pointPairs) {
    const [first, second] = pair.pointsToConnect
    const start = first?.pcb_port_id ?? first?.pointId
    const end = second?.pcb_port_id ?? second?.pointId
    if (!start || !end || pair.pointsToConnect.length !== 2) return
    if (!pairByTerminal.has(start)) pairByTerminal.set(start, new Map())
    if (!pairByTerminal.has(end)) pairByTerminal.set(end, new Map())
    pairByTerminal.get(start)!.set(end, pair.name)
    pairByTerminal.get(end)!.set(start, pair.name)
  }
  const routed = new Set([terminals[0]!])
  const branches: TerminalPair[] = []
  while (routed.size < terminals.length) {
    let shortest = Infinity
    let next: TerminalPair | undefined
    for (const start of routed) {
      const first = grid.getPoint(start.viaSite)
      for (const end of terminals) {
        if (routed.has(end)) continue
        const connectionName = pairByTerminal
          .get(start.terminalId)
          ?.get(end.terminalId)
        if (!connectionName) continue
        const last = grid.getPoint(end.viaSite)
        const distance = Math.hypot(first.x - last.x, first.y - last.y)
        if (distance >= shortest) continue
        next = { start, end, connectionName }
        shortest = distance
      }
    }
    if (!next) return
    branches.push(next)
    routed.add(next.end)
  }
  return branches
}
