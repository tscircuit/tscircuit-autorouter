import type { Obstacle } from "lib/types"

/** Raw barriers without an electrical owner or a Circuit JSON copper role. */
export function isOpaqueUnownedObstacle(obstacle: Obstacle): boolean {
  const metadata = obstacle.circuitJsonMetadata
  return (
    obstacle.connectedTo.length === 0 &&
    !(obstacle.offBoardConnectsTo?.length) &&
    !obstacle.isNonPlatedHole &&
    !metadata?.pcb_smtpad_id &&
    !metadata?.pcb_plated_hole_id &&
    !metadata?.pcb_port_id &&
    !metadata?.pcb_via_id
  )
}
