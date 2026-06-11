# Handoff: Huygens

Latest findings:
- The original full pipeline7 sweep already showed `portPointPathingSolver` as the dominant retained-heap jump and one of the longest stages.
- Stage 11 output shape is retained almost directly by stage 12, so the peak is not just transient scratch.
- The repeated `2,000,004` iteration count is suspicious and suggests a deterministic cap or saturation point.
- Existing phase data pointed to a narrow stage-11-only probe rather than another full 19-stage snapshot sweep.

References:
- [ai-artifacts/memory-analysis/pipeline7-srj18-sample001/latest-findings.md](/home/ohmx/Documents/tscircuit-autorouter/ai-artifacts/memory-analysis/pipeline7-srj18-sample001/latest-findings.md:6)
- [ai-artifacts/memory-analysis/pipeline7-srj18-sample001/phase-comparison.json](/home/ohmx/Documents/tscircuit-autorouter/ai-artifacts/memory-analysis/pipeline7-srj18-sample001/phase-comparison.json:183)
- [ai-artifacts/memory-analysis/pipeline7-srj18-sample001/run-001/11-portPointPathingSolver/handoff.md](/home/ohmx/Documents/tscircuit-autorouter/ai-artifacts/memory-analysis/pipeline7-srj18-sample001/run-001/11-portPointPathingSolver/handoff.md:4)
- [ai-artifacts/memory-analysis/pipeline7-srj18-sample001/run-001/12-uniformPortDistributionSolver/input-summary.json](/home/ohmx/Documents/tscircuit-autorouter/ai-artifacts/memory-analysis/pipeline7-srj18-sample001/run-001/12-uniformPortDistributionSolver/input-summary.json:18)
