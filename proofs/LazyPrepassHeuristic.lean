import Std

/-!
Demand evaluation of the independent-route prepass heuristic.

`Value` is opaque: the theorem neither replaces binary64 arithmetic by real
arithmetic nor assumes properties of subtraction, square root, or rounding.
`heuristic` denotes the unchanged, deterministic binary64 expression.
-/
namespace LazyPrepassHeuristic

variable {portCount : Nat} {Value State Output : Type}

/- These are deterministic operations, with no algebraic laws postulated.
They may be instantiated with binary64 operations, including their rounding. -/
structure Arithmetic (Value : Type) where
  sub : Value → Value → Value
  mul : Value → Value → Value
  add : Value → Value → Value
  sqrt : Value → Value

structure FixedRoute (portCount : Nat) (Value : Type) where
  x : Fin portCount → Value
  y : Fin portCount → Value
  endpoint : Fin portCount
  scale : Value

def routeHeuristic (ops : Arithmetic Value)
    (route : FixedRoute portCount Value) (port : Fin portCount) : Value :=
  let dx := ops.sub (route.x port) (route.x route.endpoint)
  let dy := ops.sub (route.y port) (route.y route.endpoint)
  ops.mul (ops.sqrt (ops.add (ops.mul dx dx) (ops.mul dy dy))) route.scale

inductive Primitive where
  | sub | mul | add | sqrt
  deriving DecidableEq, Repr

/- Log actual primitive calls, preserving dx/dy sharing rather than counting
the two uses of each local variable as another subtraction. -/
def record (operation : Primitive) (value : Value) : StateM (List Primitive) Value :=
  fun log => (value, log ++ [operation])

def auditedHeuristic (ops : Arithmetic Value)
    (route : FixedRoute portCount Value) (port : Fin portCount) :
    StateM (List Primitive) Value := do
  let dx ← record .sub (ops.sub (route.x port) (route.x route.endpoint))
  let dy ← record .sub (ops.sub (route.y port) (route.y route.endpoint))
  let dxSquared ← record .mul (ops.mul dx dx)
  let dySquared ← record .mul (ops.mul dy dy)
  let sum ← record .add (ops.add dxSquared dySquared)
  let distance ← record .sqrt (ops.sqrt sum)
  record .mul (ops.mul distance route.scale)

def expressionOperations : List Primitive :=
  [.sub, .sub, .mul, .mul, .add, .sqrt, .mul]

theorem audited_expression_exact (ops : Arithmetic Value)
    (route : FixedRoute portCount Value) (port : Fin portCount) :
    (auditedHeuristic ops route port).run [] =
      (routeHeuristic ops route port, expressionOperations) := by
  rfl

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

/- The two modes below use the very same immutable route and operation
implementations, not an assumed equality between independently chosen h's. -/
theorem fixed_route_trace_equivalence
    (ops : Arithmetic Value) (route : FixedRoute portCount Value)
    (step : (Fin portCount → Value) → State → State)
    (fuel : Nat) (initial : State) :
    searchTrace step (eagerLookup (routeHeuristic ops route)) fuel initial =
      searchTrace step (routeHeuristic ops route) fuel initial := by
  exact demand_preserves_search_trace (routeHeuristic ops route) step fuel initial

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

/- Eager evaluation visits all P ports once; demand evaluation visits the
observed query stream, including repeats. Each visit contributes the audited
primitive sequence, independently of the port's value. -/
def primitiveTrace (visits : List (Fin portCount)) : List Primitive :=
  visits.flatMap (fun _ => expressionOperations)

theorem primitive_count (visits : List (Fin portCount)) :
    (primitiveTrace visits).length = 7 * visits.length := by
  induction visits with
  | nil => rfl
  | cons port rest ih =>
      simp [primitiveTrace, expressionOperations] at ih ⊢
      omega

theorem primitive_savings (queries : List (Fin portCount))
    (withinTableSize : queries.length ≤ portCount) :
    (primitiveTrace queries).length + 7 * (portCount - queries.length) =
      (primitiveTrace (List.ofFn (fun port : Fin portCount => port))).length := by
  simp only [primitive_count, List.length_ofFn]
  omega

/- Across independent routes, concatenate the eager and demand visit streams.
The aggregate bound need not hold separately for every constituent route. -/
theorem batch_primitive_savings (eagerVisits queries : List (Fin portCount))
    (withinTotalTableSize : queries.length ≤ eagerVisits.length) :
    (primitiveTrace queries).length + 7 * (eagerVisits.length - queries.length) =
      (primitiveTrace eagerVisits).length := by
  simp only [primitive_count]
  omega

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
