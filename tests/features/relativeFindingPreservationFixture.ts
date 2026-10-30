import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { relativeViaTraceExistingDefectsFixture } from "./relativeViaTraceExistingDefectsFixture"

export function relativeFindingPreservationFixture(): { before: NonNullable<Pipeline9RelativeWitnessRepairSolver["baselineGeometryDetails"]>; after: NonNullable<Pipeline9RelativeWitnessRepairSolver["finalGeometryDetails"]>; baseline: NonNullable<Pipeline9RelativeWitnessRepairSolver["baselineCertificate"]>; candidate: NonNullable<Pipeline9RelativeWitnessRepairSolver["finalCertificate"]> } {
  const solver = new Pipeline9RelativeWitnessRepairSolver(relativeViaTraceExistingDefectsFixture())
  solver.solve()
  if (!solver.baselineGeometryDetails || !solver.finalGeometryDetails || !solver.baselineCertificate || !solver.finalCertificate || !solver.qualification.localRepaired) throw new Error("Synthetic preservation fixture must complete the real local stage")
  return structuredClone({ before: solver.baselineGeometryDetails, after: solver.finalGeometryDetails, baseline: solver.baselineCertificate, candidate: solver.finalCertificate })
}
