import { SpecializedIntraNodeSolverAdapter } from "lib/bindings/high-density/SpecializedIntraNodeSolverAdapter"
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types";
import { HighDensityHyperParameters } from "../HighDensityHyperParameters";
import { Candidate, PolyLine } from "./types1";
import { PolyLine2 } from "./types2";
export class MultiHeadPolyLineIntraNodeSolver extends SpecializedIntraNodeSolverAdapter {
  static override solverKind = "multi-head"
  static override diagnosticFields = ["nodeWithPortPoints", "colorMap", "hyperParameters", "connMap", "candidates", "bounds", "solvedRoutes", "unsolvedConnections", "SEGMENTS_PER_POLYLINE", "cellSize", "MAX_CANDIDATES", "viaDiameter", "obstacleMargin", "traceWidth", "availableZ", "uniqueConnections", "BOUNDARY_PADDING", "lastCandidate", "maxViaCount", "minViaCount", "phase", "progress"]
  override getSolverName(): string { return "MultiHeadPolyLineIntraNodeSolver" }
  declare nodeWithPortPoints: NodeWithPortPoints
  declare colorMap: Record<string, string>
  declare hyperParameters: Partial<HighDensityHyperParameters>
  declare connMap?: ConnectivityMap
  declare candidates: Candidate[]
  declare bounds: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    }
  declare solvedRoutes: HighDensityIntraNodeRoute[]
  declare unsolvedConnections: any[]
  declare SEGMENTS_PER_POLYLINE: number
  declare cellSize: number
  declare MAX_CANDIDATES: number
  declare viaDiameter: number
  declare obstacleMargin: number
  declare traceWidth: number
  declare availableZ: number[]
  declare uniqueConnections: number
  declare BOUNDARY_PADDING: number
  declare lastCandidate: Candidate | null
  declare maxViaCount: number
  declare minViaCount: number
  declare phase: "setup" | "solving"
  declare progress: number
  constructor(props: {
        nodeWithPortPoints: NodeWithPortPoints;
        colorMap?: Record<string, string>;
        hyperParameters?: Partial<HighDensityHyperParameters>;
        connMap?: ConnectivityMap;
        viaDiameter?: number;
    }) { super(props) }
  computeMinGapBtwPolyLines(polyLines: PolyLine2[]): number[] { return this.call(() => this.binding.computeMinGapBtwPolyLines(polyLines), [polyLines]) }
  insertCandidate(candidate: any): void { this.call(() => this.binding.insertCandidate(candidate, this.candidateIdentity!.candidate(candidate)), [candidate]) }
  setupInitialPolyLines(): void { this.call(() => this.binding.setupInitialPolyLines()) }
  computeG(polyLines: PolyLine[], candidate: Candidate): number { return this.call(() => this.binding.computeG(polyLines, candidate), [polyLines, candidate]) }
  computeH(candidate: Pick<Candidate, "minGaps" | "forces">): number { return this.call(() => this.binding.computeH(candidate), [candidate]) }
  getNeighbors(candidate: Candidate): Candidate[] { return this.call(() => this.binding.getNeighbors(candidate, this.candidateIdentity!.candidate(candidate)), [candidate]) }
  checkIfSolved(candidate: Pick<Candidate, "polyLines" | "minGaps">): boolean { return this.call(() => this.binding.checkIfSolved(candidate), [candidate]) }
  _setSolvedRoutes(): never[] | undefined { const result = this.call(() => this.binding.setSolvedRoutes()); return result === null ? undefined : result }
}
