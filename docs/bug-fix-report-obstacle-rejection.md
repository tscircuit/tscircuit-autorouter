# Bug Fix Report: Obstacle Rejection in Simplified Path Solver

## Original Problem
The `SingleSimplifiedPathSolver` was incorrectly rejecting valid path segments as "obstacle intersections." This occurred because the solver treats any component not on the same net as an obstacle. When the autorouter breaks a net into Minimum Spanning Tree (MST) segments (e.g., `source_net_1` becomes `source_net_1_mst0`, `source_net_1_mst1`), the solver failed to recognize that `source_net_1_mst0` belongs to the same electrical network as the destination pad `source_net_1`. Consequently, it treated the destination pad as an obstacle and blocked the path.

## Root Cause
The `ConnectivityMap`, which is used to determine if two IDs are electrically connected, did not have a link between the generated MST segment names (e.g., `net_mstX`) and the original parent net name (e.g., `net`).
- **Obstacles:** Defined with the original net name in their `connectedTo` list.
- **Route:** Processed with the MST-suffixed name.
- **Missing Link:** `connMap.areIdsConnected("net_mstX", "net")` returned `false`.

## Resolution Timeline

### 1. Diagnosis
- Analyzed logs to see `[Rejection] Obstacle intersection`.
- Confirmed that the obstacle being hit was indeed the destination pad.
- Identified that the `connectedTo` list contained the base name, while the route used the MST name.

### 2. Initial Approaches
- **Regex Stripping:** Considered stripping `_mst\d+` suffixes via regex in the solver. This was deemed "fragile" and a "string-based approach" that the user wanted to avoid in favor of a structured data solution.
- **Partial Fixes:** Attempted to add `parentNetId` but faced issues with type definitions and data propagation not being consistent across the entire solver pipeline.

### 3. Final Solution: Structured Data Propagation
We implemented a robust, type-safe solution by propagating the parent net ID through the entire data pipeline.

#### Changes Implemented:
1.  **Type Definitions:**
    - Updated `SimpleRouteConnection` (`lib/types/srj-types.ts`) to include `parentNetId`.
    - Updated `HighDensityIntraNodeRoute` and `PortPoint` (`lib/types/high-density-types.ts`) to include `parentNetId`.
    - Updated `NodePortSegment` (`lib/types/capacity-edges-to-port-segments-types.ts`) to include `parentNetIds`.
    - Updated `CapacityPath` (`lib/types/capacity-pathing-types.ts`) to include `parentNetId`.
    - Updated `SegmentPoint` (`lib/solvers/UnravelSolver/types.ts`) to include `parentNetId`.

2.  **Solver Logic Updates:**
    - **`NetToPointPairsSolver`**: Populated `parentNetId` (and `mergedConnectionNames` for merged nets) when creating MST connections.
    - **`CapacityPathingSolver`**: Propagated `parentNetId` from connection to `CapacityPath`.
    - **`CapacityEdgeToPortSegmentSolver`**: Propagated `parentNetId` from path to `NodePortSegment`.
    - **`CapacitySegmentToPointSolver`**: Propagated `parentNetId` to assigned points.
    - **`createSegmentPointMap`**: Propagated `parentNetId` to `SegmentPoint`.
    - **`UnravelMultiSectionSolver`**: Propagated `parentNetId` to `PortPoint` on nodes.
    - **`HyperSingleIntraNodeSolver`**: Propagated `parentNetId` from `PortPoint` to the final `HighDensityIntraNodeRoute`.
    - **`SingleHighDensityRouteStitchSolver`**: Preserved `parentNetId` when merging routes.

3.  **Connectivity Map Generation:**
    - Modified `lib/utils/getConnectivityMapFromSimpleRouteJson.ts` to explicitly add connections between `connection.name` (the MST name) and `connection.parentNetId` (the original name) when building the map.
    - Also added support for `mergedConnectionNames` to handle cases where multiple nets are merged into one super-net.


## Verification
Logs analysis confirmed that the fix successfully establishes the necessary links in the `ConnectivityMap`.
- **Log Observation:** `[ConnMap] Linking merged: source_trace_3__source_trace_4_mst1 -> source_trace_3`
- **Result:** The solver's `areIdsConnected("source_trace_3__source_trace_4_mst1", "source_trace_3")` check now returns `true`.
- **Impact:** When the path for the MST sub-route encounters a pad connected to `source_trace_3`, it is correctly identified as a valid connection point rather than an obstacle, preventing the false rejection.
