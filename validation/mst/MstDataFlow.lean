import Std

namespace MstDataFlow

-- Explicit paths permit reasoning about connectivity without assuming the
-- candidate graph is complete or trusting a particular union-find algorithm.
inductive Reach {V : Type} (edge : V → V → Prop) : V → V → Prop where
  | refl (v : V) : Reach edge v v
  | step {a b c : V} : edge a b → Reach edge b c → Reach edge a c

-- If candidate generation never crosses a cut, no selection of those
-- candidates (including Kruskal) can connect vertices across that cut.
theorem reach_preserves_cut {V : Type} {edge : V → V → Prop}
    (side : V → Bool)
    (closed : ∀ a b, edge a b → side a = side b)
    {a b : V} (path : Reach edge a b) : side a = side b := by
  induction path with
  | refl => rfl
  | step h _ ih => exact (closed _ _ h).trans ih

theorem selected_edges_cannot_repair_cut {V : Type}
    {candidate selected : V → V → Prop} (side : V → Bool)
    (subset : ∀ a b, selected a b → candidate a b)
    (closed : ∀ a b, candidate a b → side a = side b)
    {a b : V} (different : side a ≠ side b) : ¬ Reach selected a b := by
  intro path
  exact different (reach_preserves_cut side
    (fun x y h => closed x y (subset x y h)) path)

structure Terminal where
  id : Nat
  layer : Nat
  x : Int
  y : Int
  deriving DecidableEq

def coordinateKey (p : Terminal) : Int × Int := (p.x, p.y)

def topTerminal : Terminal := ⟨0, 0, 0, 0⟩
def bottomTerminal : Terminal := ⟨1, 1, 0, 0⟩

-- The numeric projection models the information retained by `${x},${y}`
-- for finite integer coordinates; it is not a model of JS number formatting.
theorem coordinate_key_loses_terminal_identity :
    topTerminal ≠ bottomTerminal ∧
    coordinateKey topTerminal = coordinateKey bottomTerminal := by
  decide

-- Any connectivity abstraction based only on this key necessarily identifies
-- these terminals, even though no electrical-connectivity witness was supplied.
theorem coordinate_connectivity_cannot_reflect_identity :
    ¬ (∀ a b : Terminal, coordinateKey a = coordinateKey b → a = b) := by
  intro reflects
  have same := reflects topTerminal bottomTerminal rfl
  exact coordinate_key_loses_terminal_identity.1 same

-- An explicit witness of the 22-terminal, two-cluster failure. The TypeScript
-- audit separately checks that its actual returned edges stay inside this cut.
def clusterSide (v : Fin 22) : Bool := decide (v.val < 11)

theorem separated_clusters_are_unreachable :
    ¬ Reach (fun a b : Fin 22 => clusterSide a = clusterSide b)
      (0 : Fin 22) (21 : Fin 22) := by
  intro path
  have same := reach_preserves_cut clusterSide (fun _ _ h => h) path
  change true = false at same
  contradiction

-- Dropping an MST edge is sound for connectivity only when the edge can be
-- replaced by a path in retained edges or explicit initial connectivity.
theorem replace_edges_with_witnessed_paths {V : Type}
    {before after : V → V → Prop}
    (witness : ∀ a b, before a b → Reach after a b)
    {a b : V} (path : Reach before a b) : Reach after a b := by
  have append : ∀ {x y z : V}, Reach after x y → Reach after y z →
      Reach after x z := by
    intro x y z first second
    induction first with
    | refl => exact second
    | step h _ ih => exact Reach.step h (ih second)
  induction path with
  | refl => exact Reach.refl _
  | step h _ ih => exact append (witness _ _ h) ih

#print axioms selected_edges_cannot_repair_cut
#print axioms coordinate_connectivity_cannot_reflect_identity
#print axioms separated_clusters_are_unreachable
#print axioms replace_edges_with_witnessed_paths

end MstDataFlow
