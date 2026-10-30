import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { preservePipeline9RelativeFindings } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preservePipeline9RelativeFindings"
import { relativeViaTraceAnonymousHardFixture } from "./relativeViaTraceAnonymousHardFixture"

test("anonymous ownership never permits changed identities or ambiguous copper declarations", () => {
  const solver = new Pipeline9RelativeWitnessRepairSolver(relativeViaTraceAnonymousHardFixture()); solver.solve()
  const original = { before: solver.baselineGeometryDetails!, after: solver.finalGeometryDetails!, baseline: solver.baselineCertificate!, candidate: solver.finalCertificate! }
  for (const mutate of [
    (record: any) => { record.originalObstacleOwner.reason += "-changed" },
    (record: any) => { record.originalObstacleOwner.status = "RESOLVED" },
    (record: any) => { record.originalObstacle.center.x += 0.01 },
    (record: any) => { record.originalObstacle.componentId += "-other" },
    (record: any) => { record.originalObstacle.layers.reverse() },
    (record: any) => { record.finding.severity += 0.000001 },
  ]) {
    const changed = structuredClone(original)
    mutate(changed.after.srjObstacles.find((record) => record.originalObstacleOwner.status === "UNKNOWN"))
    expect(preservePipeline9RelativeFindings(changed).status).toBe("UNKNOWN")
  }
  for (const mutate of [
    (record: any) => { record.originalObstacle.connectedTo = ["unresolved-copper-alias"] },
    (record: any) => { record.originalObstacle.circuitJsonMetadata = { pcb_smtpad_id: "unresolved-pad" } },
    (record: any) => { record.originalObstacle.pcb_port_id = "unresolved-port" },
    (record: any) => { record.originalObstacleOwner.reason = "" },
    (record: any) => { delete record.originalObstacleIndex },
    (record: any) => { record.originalObstacle.width = NaN },
    (record: any) => { delete record.raw },
  ]) {
    const changed = structuredClone(original)
    for (const details of [changed.before, changed.after]) for (const record of [...details.srjObstacles, ...details.viaPadPolicy]) if (record.originalObstacleOwner.status === "UNKNOWN") mutate(record)
    expect(preservePipeline9RelativeFindings(changed).status).toBe("UNKNOWN")
  }
})
