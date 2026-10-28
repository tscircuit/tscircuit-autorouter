import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"

/** Preserve both physical terminals when their grid route contains one cell. */
export class EndpointPreservingHighDensitySolverA01 extends HighDensitySolverA01 {
  override getOutput(): ReturnType<HighDensitySolverA01["getOutput"]> {
    const output = super.getOutput()
    if (output.length === 0) return output

    // The pinned A01 emits routes in solvedConnectionsMap insertion order.
    // Read the actual endpoint from that public map, never from a nearest-port
    // guess: different terminals can share a grid cell and connection name.
    let outputIndex = 0
    for (const segments of this.solvedConnectionsMap.values()) {
      for (const segment of segments) {
        const route = output[outputIndex++]
        if (!route) {
          throw new Error("A01 output does not match its public solved-connection map")
        }
        if (route.route.length !== 1) continue
        const { startPoint, endPoint } = segment
        if (
          startPoint.x === endPoint.x &&
          startPoint.y === endPoint.y &&
          startPoint.z === endPoint.z
        ) continue
        route.route.push({ ...endPoint })
      }
    }
    if (outputIndex !== output.length) {
      throw new Error("A01 output contains routes absent from its public solved-connection map")
    }
    return output
  }
}
