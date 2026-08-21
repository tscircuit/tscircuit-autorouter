import type { SimpleRouteJson } from "lib/types";

/**
 * Adds Circuit JSON provenance to fixtures generated before
 * `circuitJsonMetadata` existed. Those producers stored the obstacle's own ID
 * first in `connectedTo`, then repeated it immediately before its PCB port ID.
 * IDs remain opaque; only that historical ordering and pad layer count are used.
 */
export const migrateLegacyObstacleCircuitJsonMetadata = (
  srj: SimpleRouteJson,
): SimpleRouteJson => {
  const obstacles = srj.obstacles.map((obstacle) => {
    if (obstacle.circuitJsonMetadata) return obstacle;

    const elementId = obstacle.connectedTo[0];
    if (!elementId) return obstacle;

    const repeatedElementIndex = obstacle.connectedTo.indexOf(elementId, 1);
    if (repeatedElementIndex === -1) return obstacle;

    const pcbPortId = obstacle.connectedTo[repeatedElementIndex + 1];
    if (!pcbPortId) return obstacle;

    return {
      ...obstacle,
      circuitJsonMetadata:
        obstacle.layers.length > 1
          ? { pcb_plated_hole_id: elementId, pcb_port_id: pcbPortId }
          : { pcb_smtpad_id: elementId, pcb_port_id: pcbPortId },
    };
  });

  return { ...srj, obstacles };
};
