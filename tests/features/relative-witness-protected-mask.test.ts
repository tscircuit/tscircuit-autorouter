import { expect, test } from "bun:test"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { provePipeline9RelativeContacts } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/provePipeline9RelativeContacts"
import { relativeWitnessRepairFixture, relativeFixtureProposal, proveRelativeFixture } from "./relativeWitnessRepairFixture"

test("relative proof rejects material, terminal, missing alias, unselected XY and canonical forgeries", () => {
  for (const kind of ["width", "layer", "unselected", "missing-landing", "cap", "canonical"]) {
    const input = relativeWitnessRepairFixture(), proposal = relativeFixtureProposal(input)
    if (kind === "width") Object.assign(proposal.after[0]!.route[7]!, { via_diameter: 0.31 })
    if (kind === "layer") Object.assign(proposal.after[0]!.route[6]!, { layer: "top" })
    if (kind === "unselected") Object.assign(proposal.after[2]!.route[1]!, { x: -2.89 })
    if (kind === "missing-landing") proposal.moves[0]!.occurrences.pop()
    if (kind === "cap") proposal.moves[1]!.occurrences[0]!.newXY.y += 0.03
    if (kind !== "canonical") expect(proveRelativeFixture(input, proposal).status).toBe("UNKNOWN")
    else {
      const baselineCertificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
      const candidateCertificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, proposal.after)
      candidateCertificate.circuitJson.push({ type: "pcb_via", pcb_via_id: "hidden", pcb_trace_id: "a", x: 2, y: 2, outer_diameter: 0.3, hole_diameter: 0.15, layers: ["top", "inner1", "inner2", "bottom"] })
      expect(provePipeline9RelativeContacts({ original: input.originalSrj, pointPairs: input.pointPairs, before: input.traces, after: proposal.after, moves: proposal.moves, baselineCertificate, candidateCertificate }).status).toBe("UNKNOWN")
    }
  }
})
