# Trace Thickness Implementation Plan

## Current State

The codebase already has infrastructure for trace thickness:
- `SimpleRouteConnection.nominalTraceWidth` - per-connection trace width specification
- `SimpleRouteJson.nominalTraceWidth` - global default trace width
- `TraceWidthSolver` - adjusts trace widths post-routing based on clearance
- `HighDensityRoute.traceThickness` - stores the thickness of routed traces

## The Problem

While `TraceWidthSolver` can adjust widths after routing, the ROUTING phase itself doesn't consider trace thickness:

1. **Capacity Calculations**: Nodes don't reserve appropriate capacity for thick traces
2. **High-Density Routing**: All routes are initially created with `minTraceWidth`
3. **Pathfinding**: Doesn't consider that thicker traces need more space

## Implementation Approach

### Phase 1: Pass Through Connection-Specific Trace Widths
- [x] Verify `nominalTraceWidth` exists in connection types  
- [ ] Update high-density solvers to look up per-connection trace widths
- [ ] Initialize HD routes with correct `traceThickness` from connection spec

### Phase 2: Capacity-Aware Routing
- [ ] Update capacity calculations to account for trace thickness
- [ ] Modify pathfinding to consider trace width when evaluating routes
- [ ] Adjust obstacle margins based on trace thickness

### Phase 3: High-Density Routing Improvements
- [ ] Update collision detection to use actual trace thickness
- [ ] Ensure via placement accounts for trace width
- [ ] Update spatial indexes to consider trace thickness

### Phase 4: Testing & Documentation
- [ ] Add comprehensive tests for 2x, 4x, 8x multiples
- [ ] Test mixed trace widths on same board
- [ ] Add examples to documentation
- [ ] Test edge cases (obstacles, crossings, etc.)

## Files to Modify

1. `lib/autorouter-pipelines/AssignableAutoroutingPipeline2/SimpleHighDensitySolver.ts`
2. `lib/autorouter-pipelines/AssignableAutoroutingPipeline2/JumperHighDensitySolver.ts`
3. `lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure.ts`
4. `lib/utils/getTunedTotalCapacity1.ts`
5. `lib/data-structures/HighDensityRouteSpatialIndex.ts`

## Testing Strategy

1. Simple test: Two parallel traces with different widths
2. Complex test: Mixed trace widths with obstacles  
3. Stress test: High-density routing with thick power traces
4. Edge cases: Very thick traces (8x), single-layer boards
