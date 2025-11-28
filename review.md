# Code Review: Off-Board Connection Solvers

## Files Changed
- `lib/solvers/AssignableViaAutoroutingPipeline/OffboardCapacityNodeSolver.ts` (new)
- `lib/solvers/AssignableViaAutoroutingPipeline/OffboardPathFragmentSolver.ts` (new)
- `lib/solvers/AssignableViaAutoroutingPipeline/AssignableViaAutoroutingPipelineSolver.ts` (modified)
- `lib/types/capacity-mesh-types.ts` (modified)
- `lib/types/capacity-pathing-types.ts` (modified)

---

## Candidates for Utils Extraction

### 1. **Point-in-Node Check** (OffboardPathFragmentSolver.ts) ✅ DONE

**Status:** Implemented - using `isPointInRect` from `lib/utils/isPointInRect.ts`

---

### 2. **Node Map Builder** ✅ DONE

**Status:** Implemented - created `lib/utils/createNodeMap.ts` and used in both solvers

---

### 3. **Find Node by ID** (OffboardCapacityNodeSolver.ts) ✅ DONE

**Status:** Implemented - replaced `find()` with `nodeMap.get()` for O(1) lookup

---

### 4. **Group Nodes by Property** (OffboardCapacityNodeSolver.ts) ⏭️ SKIPPED

**Status:** Skipped - too specific for a generic utility

---

### 5. **Edge Midpoint Calculation** ✅ DONE

**Status:** Implemented - created `lib/utils/getMidpoint.ts` and used in OffboardCapacityNodeSolver

---

## Priority Actions

| Priority | Action | Effort | Impact | Status |
|----------|--------|--------|--------|--------|
| High | Use `isPointInRect` from utils | Low | Reduces duplication | ✅ Done |
| Medium | Create `createNodeMap` utility | Low | Improves consistency | ✅ Done |
| Medium | Replace `find()` with map lookup | Low | Performance improvement | ✅ Done |
| Low | Extract `getMidpoint` utility | Low | Minor cleanup | ✅ Done |

---

## New Utils Created

1. `lib/utils/createNodeMap.ts` - Creates a Map from capacity nodes for O(1) lookups
2. `lib/utils/getMidpoint.ts` - Calculates midpoint between two points

---

## Type Additions Review

### capacity-mesh-types.ts
- Added `isOffboardEdge?: boolean` to `CapacityMeshEdge`
- Added `offboardNetName?: string` to `CapacityMeshEdge`

**Assessment:** Appropriate additions for the offboard connection feature.

### capacity-pathing-types.ts
- Added `isFragmentedPath?: boolean` to `CapacityPath`
- Added `originalConnectionName?: string` to `CapacityPath`

**Assessment:** Appropriate additions for path fragmentation tracking.

---

## Summary

All refactoring recommendations have been implemented:
- ✅ Used existing `isPointInRect` utility
- ✅ Created and used `createNodeMap` utility
- ✅ Replaced O(n) `find()` with O(1) map lookups
- ✅ Created and used `getMidpoint` utility
