import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import type { TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { RegionDistancePreparationSolver, type RegionDistancePreparationInput } from "./RegionDistancePreparationSolver"

export class PreparedRoutingGeometry {
  readonly rowOffsets: Int32Array
  private readonly jobs: RegionDistancePreparationInput[] = []
  distances?: Float64Array
  readonly supported: boolean

  constructor(private readonly topology: TinyHyperGraphTopology) {
    this.rowOffsets = new Int32Array(topology.portCount * 2).fill(-1)
    let size = 0
    // Dense preparation specializes the ordinary two-region incidence graph.
    // General incidence and very large tables continue using native expansion.
    this.supported = topology.incidentPortRegion.every(regions => regions.length <= 2) &&
      topology.regionIncidentPorts.reduce((sum, ports) => sum + ports.length ** 2, 0) <= 16_777_216
    if (!this.supported) return
    for (let region = 0; region < topology.regionCount; region++) {
      const ports = topology.regionIncidentPorts[region]!
      for (let index = 0; index < ports.length; index++) {
        const port = ports[index]!
        const slot = port * 2 + (topology.incidentPortRegion[port]![0] === region ? 0 : 1)
        this.rowOffsets[slot] = size + index * ports.length
      }
      size += ports.length ** 2
    }
    let regions: number[][] = []
    let work = 0
    for (const ports of topology.regionIncidentPorts) {
      regions.push(ports)
      work += ports.length ** 2
      if (work >= size / 4 && this.jobs.length < 3) {
        this.jobs.push({portX: topology.portX, portY: topology.portY, regions})
        regions = []
        work = 0
      }
    }
    if (regions.length) this.jobs.push({portX: topology.portX, portY: topology.portY, regions})
  }

  private accept(parts: Float64Array[]): void {
    this.distances = new Float64Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
      this.distances.set(part, offset)
      offset += part.length
    }
  }

  prepare(): void {
    if (this.distances || !this.supported) return
    this.accept(this.jobs.map(input => {
      const solver = new RegionDistancePreparationSolver(input)
      solver.solve()
      return solver.getOutput()
    }))
  }

  async prepareAsync(runtime: SolverRuntimeExecutor): Promise<void> {
    if (this.distances || !this.supported) return
    this.accept(await Promise.all(this.jobs.map(input => runtime.executeAsync(RegionDistancePreparationSolver, input))))
  }
}
