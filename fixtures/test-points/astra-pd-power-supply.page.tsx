import { useMemo } from "react"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { TestPointSolver } from "../../lib/solvers/TestPointSolver/TestPointSolver"
import type { SimpleRouteJson } from "../../lib/types"
import input from "../../tests/test-points/fixtures/astra-pd-power-supply.srj.json"

export default function PdPowerSupplyTestPointsPage() {
  const solver = useMemo(() => new TestPointSolver(input as SimpleRouteJson, {
    requests: [
      { name: "TP_SDA", pcbTraceId: "source_net_33_mst0_0", layer: "bottom", diameter: 1 },
      { name: "TP_SCL", pcbTraceId: "source_net_34_mst0_0", layer: "bottom", diameter: 1 },
      { name: "TP_OUTPUT_EN", pcbTraceId: "source_net_50_mst1_0", layer: "bottom", diameter: 1 },
    ], clearance: 0.2, minProbeSpacing: 2.54, maxDetour: 1,
  }), [])
  return <GenericSolverDebugger solver={solver} />
}
