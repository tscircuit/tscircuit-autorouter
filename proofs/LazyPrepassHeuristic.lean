import Std

/-!
Demand evaluation of the independent-route prepass heuristic.

`Value` is opaque: the theorem neither replaces binary64 arithmetic by real
arithmetic nor assumes properties of subtraction, square root, or rounding.
`heuristic` denotes the unchanged, deterministic binary64 expression.
-/
namespace LazyPrepassHeuristic

variable {portCount : Nat} {Value State Output : Type}

def eagerTable (heuristic : Fin portCount → Value) : Array Value :=
  Array.ofFn heuristic

def eagerLookup (heuristic : Fin portCount → Value)
    (port : Fin portCount) : Value :=
  (eagerTable heuristic)[port.val]'(by simp [eagerTable])

theorem eagerLookup_eq (heuristic : Fin portCount → Value)
    (port : Fin portCount) : eagerLookup heuristic port = heuristic port := by
  simp [eagerLookup, eagerTable]

theorem eagerEvaluator_eq (heuristic : Fin portCount → Value) :
    eagerLookup heuristic = heuristic := by
  funext port
  exact eagerLookup_eq heuristic port

/- Each transition may adaptively query any ports and perform arbitrary
deterministic queue, tie-breaking, pruning, and termination operations.
Terminal states can be represented by an absorbing transition. -/
def searchTrace (step : (Fin portCount → Value) → State → State)
    (evaluate : Fin portCount → Value) : Nat → State → List State
  | 0, state => [state]
  | fuel + 1, state =>
      state :: searchTrace step evaluate fuel (step evaluate state)

theorem demand_preserves_search_trace
    (heuristic : Fin portCount → Value)
    (step : (Fin portCount → Value) → State → State)
    (fuel : Nat) (initial : State) :
    searchTrace step (eagerLookup heuristic) fuel initial =
      searchTrace step heuristic fuel initial := by
  rw [eagerEvaluator_eq]

theorem demand_preserves_observation
    (heuristic : Fin portCount → Value)
    (step : (Fin portCount → Value) → State → State)
    (fuel : Nat) (initial : State)
    (observe : List State → Output) :
    observe (searchTrace step (eagerLookup heuristic) fuel initial) =
      observe (searchTrace step heuristic fuel initial) := by
  rw [demand_preserves_search_trace]

/- Queries include repetitions. Lazy evaluation does not memoize, so there is
no unconditional work bound by the number of ports. These bounds are expressly
conditional on a measured query-count bound. -/
def eagerEvaluationCount (ports : Nat) : Nat := ports

def demandEvaluationCount (queries : List (Fin portCount)) : Nat :=
  queries.length

theorem saved_evaluations
    (queries : List (Fin portCount))
    (withinTableSize : queries.length ≤ portCount) :
    demandEvaluationCount queries + (portCount - queries.length) =
      eagerEvaluationCount portCount := by
  simp only [demandEvaluationCount, eagerEvaluationCount]
  omega

theorem strict_evaluation_improvement
    (queries : List (Fin portCount))
    (fewerQueries : queries.length < portCount) :
    demandEvaluationCount queries < eagerEvaluationCount portCount := by
  exact fewerQueries

/- Only the heuristic value buffer is counted; other solver state remains. -/
def eagerHeuristicBufferBytes (ports : Nat) : Nat := 8 * ports

def demandHeuristicBufferBytes : Nat := 0

theorem heuristic_buffer_reduction (ports : Nat) :
    eagerHeuristicBufferBytes ports - demandHeuristicBufferBytes = 8 * ports := by
  rfl

end LazyPrepassHeuristic
