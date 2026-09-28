import Std

/-!
Structural contract for buildSerializedTinyGraph at autorouter revision
8e8adc693d63f89583b71862f7c39c9d82791a79. No geometry/cost arithmetic is modeled.
Tagged identifiers express the REQUIRED assumption that generated terminal IDs
are distinct from original IDs and each other. TypeScript strings do not
establish that assumption. Region and Port types enumerate existing objects:
resolved, unique original IDs are another explicit correspondence assumption.
-/
namespace PathingContract

variable {Region Port : Type}

structure Graph (Region Port : Type) where
  endpoints : Port → Region × Region
  listed : Region → Port → Prop

/-- Exact reciprocal pointIds contract, including the converse direction. -/
def WellFormed (g : Graph Region Port) : Prop :=
  ∀ r p, g.listed r p ↔ r = (g.endpoints p).1 ∨ r = (g.endpoints p).2

inductive Extended (α : Type) where
  | original : α → Extended α
  | start : Extended α
  | finish : Extended α
  deriving DecidableEq

open Extended

/-- The two ports pushed by buildSerializedTinyGraph have original region1
and terminal region2. Every original endpoint pair remains unchanged. -/
def terminalEndpoints (g : Graph Region Port) (s t : Region) :
    Extended Port → Extended Region × Extended Region
  | original p => (original (g.endpoints p).1, original (g.endpoints p).2)
  | start => (original s, start)
  | finish => (original t, finish)

/-- Membership in copied original pointIds plus the two pushes, and singleton
pointIds on the new terminal regions. Multiplicity/order are intentionally erased. -/
def terminalListed (g : Graph Region Port) (s t : Region) :
    Extended Region → Extended Port → Prop
  | original r, original p => g.listed r p
  | original r, start => r = s
  | original r, finish => r = t
  | start, start => True
  | finish, finish => True
  | _, _ => False

def injectTerminals (g : Graph Region Port) (s t : Region) :
    Graph (Extended Region) (Extended Port) :=
  ⟨terminalEndpoints g s t, terminalListed g s t⟩

theorem terminal_incidence_preserved (g : Graph Region Port) (s t : Region)
    (h : WellFormed g) : WellFormed (injectTerminals g s t) := by
  unfold WellFormed at h ⊢
  intro r p
  cases r <;> cases p <;>
    simp [injectTerminals, terminalListed, terminalEndpoints, h]

/-- A port traversal uses its actual two endpoints, in either direction. -/
def Step (g : Graph Region Port) (a b : Region) : Prop :=
  ∃ p, (g.endpoints p = (a, b)) ∨ (g.endpoints p = (b, a))

/-- Finite valid region walks; neither simplicity nor geometric feasibility. -/
inductive Walk (g : Graph Region Port) : Region → Region → Prop where
  | nil (a) : Walk g a a
  | cons {a b c} : Step g a b → Walk g b c → Walk g a c

theorem walk_append {g : Graph Region Port} {a b c : Region}
    (left : Walk g a b) (right : Walk g b c) : Walk g a c := by
  induction left with
  | nil => exact right
  | cons edge _ ih => exact .cons edge (ih right)

theorem original_step_lifts (g : Graph Region Port) (s t a b : Region)
    (h : Step g a b) :
    Step (injectTerminals g s t) (original a) (original b) := by
  obtain ⟨p, hp⟩ := h
  refine ⟨original p, ?_⟩
  rcases hp with hp | hp
  · left
    change (original (g.endpoints p).1, original (g.endpoints p).2) = _
    simp [hp]
  · right
    change (original (g.endpoints p).1, original (g.endpoints p).2) = _
    simp [hp]

theorem original_walk_lifts (g : Graph Region Port) (s t : Region)
    {a b : Region} (h : Walk g a b) :
    Walk (injectTerminals g s t) (original a) (original b) := by
  induction h with
  | nil a => exact .nil _
  | cons edge _ ih => exact .cons (original_step_lifts g s t _ _ edge) ih

/-- Every original path can be enclosed by the two injected terminal edges. -/
theorem terminal_path_lifting (g : Graph Region Port) (s t : Region)
    (h : Walk g s t) : Walk (injectTerminals g s t) start finish := by
  apply Walk.cons (b := original s)
  · exact ⟨start, Or.inr rfl⟩
  · apply walk_append (original_walk_lifts g s t h)
    exact .cons ⟨finish, Or.inl rfl⟩ (.nil _)

def collapse (s t : Region) : Extended Region → Region
  | original r => r
  | start => s
  | finish => t

/-- Terminal edges become zero steps. This covers revisiting terminal leaves,
not merely paths produced by the lifting theorem. -/
theorem projected_step (g : Graph Region Port) (s t : Region)
    {a b : Extended Region} (h : Step (injectTerminals g s t) a b) :
    Walk g (collapse s t a) (collapse s t b) := by
  obtain ⟨p, hp⟩ := h
  cases p with
  | original p =>
    rcases hp with hp | hp
    · change (original (g.endpoints p).1, original (g.endpoints p).2) = (a, b) at hp
      cases hp
      exact .cons ⟨p, Or.inl rfl⟩ (.nil _)
    · change (original (g.endpoints p).1, original (g.endpoints p).2) = (b, a) at hp
      cases hp
      exact .cons ⟨p, Or.inr rfl⟩ (.nil _)
  | start =>
    rcases hp with hp | hp
    · change (original s, start) = (a, b) at hp
      cases hp
      exact .nil _
    · change (original s, start) = (b, a) at hp
      cases hp
      exact .nil _
  | finish =>
    rcases hp with hp | hp
    · change (original t, finish) = (a, b) at hp
      cases hp
      exact .nil _
    · change (original t, finish) = (b, a) at hp
      cases hp
      exact .nil _

theorem terminal_path_projection (g : Graph Region Port) (s t : Region)
    {a b : Extended Region} (h : Walk (injectTerminals g s t) a b) :
    Walk g (collapse s t a) (collapse s t b) := by
  induction h with
  | nil => exact .nil _
  | cons edge _ ih => exact walk_append (projected_step g s t edge) ih

/-- Terminal injection neither invents nor destroys endpoint reachability. -/
theorem terminal_reachability_iff (g : Graph Region Port) (s t : Region) :
    Walk (injectTerminals g s t) start finish ↔ Walk g s t := by
  constructor
  · exact terminal_path_projection g s t
  · exact terminal_path_lifting g s t

def originalPort : Extended Port → Option Port
  | original p => some p
  | _ => none

/-- Terminal removal, as used when rebuilding input nodes, recovers any
original port sequence after injection. Solved output retains terminal points. -/
theorem terminal_port_sequence_roundtrip (ps : List Port) :
    (start :: ps.map original ++ [finish]).filterMap originalPort = ps := by
  induction ps with
  | nil => rfl
  | cons p ps ih =>
    simpa [originalPort] using congrArg (List.cons p) ih

/-- Legacy JS allowed undefined === undefined. Option equality reproduces that
mistake structurally; this does not model JavaScript coercion. -/
def legacyReuse (current assigned : Option Nat) : Bool := current == assigned

def validatedReuse (current assigned : Option Nat) : Bool :=
  match current with
  | none => false
  | some root => assigned == some root

theorem legacy_missing_root_counterexample : legacyReuse none none = true := rfl

theorem missing_root_cannot_authorize_reuse (assigned : Option Nat) :
    validatedReuse none assigned = false := rfl

theorem equal_present_root_authorizes_reuse (root : Nat) :
    validatedReuse (some root) (some root) = true := by
  simp [validatedReuse]

/-- Abstract committed route/port incidence. Multiple owners may share a port.
Removing one route must keep every surviving incidence witness. -/
def removeRoute (removed : Nat) (assignments : List (Nat × Nat)) : List (Nat × Nat) :=
  assignments.filter (fun assignment => assignment.1 != removed)

def Occupied (port : Nat) (assignments : List (Nat × Nat)) : Prop :=
  ∃ owner, (owner, port) ∈ assignments

theorem surviving_owner_preserves_occupancy (assignments : List (Nat × Nat))
    (removed survivor port : Nat) (different : survivor ≠ removed)
    (present : (survivor, port) ∈ assignments) :
    Occupied port (removeRoute removed assignments) := by
  refine ⟨survivor, ?_⟩
  simp [removeRoute, different, present]

/-- Canonical field wins over a legacy alias whenever present. -/
def resolveNet (canonical aliasId : Option Nat) : Option Nat :=
  canonical.orElse (fun _ => aliasId)

theorem canonical_net_has_priority (net : Nat) (aliasId : Option Nat) :
    resolveNet (some net) aliasId = some net := rfl

theorem alias_used_only_without_canonical (aliasId : Option Nat) :
    resolveNet none aliasId = aliasId := rfl

#print axioms walk_append
#print axioms original_step_lifts
#print axioms original_walk_lifts
#print axioms projected_step
#print axioms canonical_net_has_priority
#print axioms alias_used_only_without_canonical
#print axioms legacy_missing_root_counterexample
#print axioms missing_root_cannot_authorize_reuse
#print axioms equal_present_root_authorizes_reuse
#print axioms surviving_owner_preserves_occupancy
#print axioms terminal_incidence_preserved
#print axioms terminal_path_lifting
#print axioms terminal_path_projection
#print axioms terminal_reachability_iff
#print axioms terminal_port_sequence_roundtrip

end PathingContract
