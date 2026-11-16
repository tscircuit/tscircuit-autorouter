#!/usr/bin/env python3
"""Prove a recovery-only diagnostic in memory; never write or import an AR entry."""
import argparse
import hashlib
import json
from pathlib import Path

INPUT_SHA256 = "705b0ecd6484536ae9732c886c1bd35b5b97c20c98708f05d993c34ddbbbf9e2"
PREPARED = b"createGreedyFinalRouteSolver(e,t){if(t>=0)return super.createGreedyFinalRouteSolver(e,t);const n=new fQ(this.topology,this.problem,{...e,MAX_ITERATIONS:Math.max(e.MAX_ITERATIONS??5e4,2*this.MAX_ITERATIONS)},this.geometry);return n.remainingReripBudget=this.costAwareFinalReripBudget-this.state.ripCount,n}"
NON_PREPARED = b"createGreedyFinalRouteSolver(e,t){if(t>=0)return super.createGreedyFinalRouteSolver(e,t);const n=new lQ(this.topology,this.problem,{...e,MAX_ITERATIONS:Math.max(e.MAX_ITERATIONS??5e4,2*this.MAX_ITERATIONS)});return n.remainingReripBudget=this.costAwareFinalReripBudget-this.state.ripCount,n}"
MAIN_BUDGET = b"MAX_ITERATIONS:Math.ceil(2e6*o*i)"
CLASS_ANCHOR = b"yQ=class extends hQ{geometry=new gQ(this.topology);workspace=new dQ(this.geometry);"
DISPATCH = b"e.solverClass=n?yQ:hQ"

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("entry", type=Path)
    parser.add_argument("proof", type=Path)
    args = parser.parse_args()
    path = args.entry.resolve(strict=True)
    original = path.read_bytes()
    if digest(original) != INPUT_SHA256:
        raise ValueError("Refuse non-published AR1109 entry")
    for anchor in [PREPARED, NON_PREPARED, MAIN_BUDGET, CLASS_ANCHOR, DISPATCH]:
        if original.count(anchor) != 1:
            raise ValueError("Expected unique published class/factory/budget anchor")
    class_start = original.index(CLASS_ANCHOR)
    factory_start = original.index(PREPARED)
    class_end = original.index(b"async solveAsync(e,t=1/0)", class_start)
    if not class_start < factory_start < class_end:
        raise ValueError("Factory is outside exact Prepared class")
    replacement = PREPARED.replace(b",2*this.MAX_ITERATIONS)", b",4*this.MAX_ITERATIONS)")
    if replacement == PREPARED:
        raise ValueError("Recovery multiplier replacement failed")
    candidate = original.replace(PREPARED, replacement, 1)
    offsets = [index for index, pair in enumerate(zip(original, candidate)) if pair[0] != pair[1]]
    if len(candidate) != len(original) or len(offsets) != 1:
        raise ValueError("Diagnostic must change exactly one ASCII digit")
    offset = offsets[0]
    if original[offset:offset + 1] != b"2" or candidate[offset:offset + 1] != b"4":
        raise ValueError("Unexpected changed bytes")
    restored = candidate.replace(replacement, PREPARED, 1)
    if restored != original or digest(path.read_bytes()) != INPUT_SHA256:
        raise ValueError("Baseline restoration or immutability proof failed")
    if candidate.count(NON_PREPARED) != 1 or candidate.count(MAIN_BUDGET) != 1:
        raise ValueError("Unrelated factory/main cap changed")
    proof = {
        "status": "prepared-only; not installed, imported, routed, pushed or proposed for production",
        "publishedAutorouter": "0.0.1109", "inputEntry": str(path),
        "inputSha256": INPUT_SHA256, "candidateSha256": digest(candidate),
        "inputBytes": len(original), "candidateBytes": len(candidate),
        "changedByteOffsets": offsets, "originalByte": "2", "replacementByte": "4",
        "classRuntimeName": "yQ", "classSourceName": "PreparedPortPointRoutingSolver",
        "childRuntimeName": "fQ", "childSourceName": "PreparedFinalRouteSolver",
        "originalFactoryAnchor": PREPARED.decode(), "replacementFactoryAnchor": replacement.decode(),
        "primaryGraphCoefficientUnchanged": True, "mainCapAnchor": MAIN_BUDGET.decode(),
        "nonPreparedSelectiveFactoryUnchanged": True, "ordinaryGreedy50kUnchanged": True,
        "adapterFormulasUnchanged": True, "weightsGraphRulesOrEffortChanged": False,
        "conditionalEligibilityAndAttemptOrderUnchanged": True,
        "parent2MChildBefore4MAfter8M": True, "nativeClassSelection": "pending latest3203 observations; source dispatcher only",
        "generalFormula": "max(options.MAX_ITERATIONS ?? 50000, parent.MAX_ITERATIONS * 4) instead of multiplier2",
        "restoredSha256": digest(restored), "restorationByteExact": True,
        "publishedEntryUnchangedAfterCheck": True,
        "fullCandidateEntryRetained": False,
    }
    encoded = json.dumps(proof, indent=2, sort_keys=True) + "\n"
    if args.proof.exists() and args.proof.read_text() != encoded:
        raise ValueError("Refuse to replace a different preparation proof")
    args.proof.write_text(encoded)
    print(json.dumps({"proof": str(args.proof), "candidateSha256": digest(candidate), "changedByteOffsets": offsets, "entryRetained": False}))

if __name__ == "__main__":
    main()
