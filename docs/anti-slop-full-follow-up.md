# Continued full-rule review

The continuation from `fc68d2b` to `2d57cee` resolves **78 additional diagnostics**
without new suppressions, `SAFETY:` comments, public schema changes, or dependency
changes. This is reviewed migration progress. **851 errors remain active** and
lint exits 1; the count is not a completion criterion.

| Remaining rule | Count | Review outcome |
| --- | ---: | --- |
| Safety explanations for assertions | 361 | Mixed unchecked construction, external interfaces, and actual invariants; prove each owner contract. |
| Runtime `typeof` | 254 | Many boundary/environment guards are necessary; a blanket removal changes behavior. |
| Known-value widening | 95 | Mixed broad contracts and syntactic reports on precise anonymous annotations. |
| Unsafe dictionary values | 62 | These contain `any`, `unknown`, `object` or similar escape hatches; concrete owner types can help where the payload is known. |
| Conditional empty spreads | 43 | Explicit-construction backlog; preserve omitted keys, insertion order, references and branch conditions. |
| `unknown` parameters | 24 | Mixed heterogeneous debug input and unvalidated external data; do not falsely promise a narrower input. |
| Chained assertions | 7 | The interface/schema/event conflicts recorded in `anti-slop-fixes.md` remain. |
| `unknown` returns | 4 | Heterogeneous serializers and boundary values need an explicit output contract decision. |
| Broad object parameters | 1 | A container allocator inside the arbitrary-object debug serializer. |

The other 15 enabled rules have zero findings. These categories are review queues;
they do not label all remaining diagnostics as unavoidable or safe.

## Safe changes made

`6ad4c09` removes **37 assertions** from graphics construction, optimizer
operations, jumper literals and template-literal spatial/cache keys. Existing
typed return values, collections and owned variable annotations now check the
values. The three mutable graphics initializers retain their exact required-array
contract. All 19 files emit identical minified JavaScript.
The jumper literals remain under the existing broad definitions contract;
removing their redundant casts does not validate that dictionary, whose finding
remains active.

`d197b97` removes **21 more assertions** from port-point factories and arrays,
tuple callbacks, obstacle inputs, SOIC obstacle rows/columns and the cache's typed
Map. Existing constructor types check solver parameters. An explicit constructor
tuple return type preserves mutable connection arrays through the pipeline's
`const` generic inference. These changes also emit identical minified JavaScript.

`2d57cee` removes **six further assertions** and **14 conditional spreads** in five
files. The crossing constructors use literal discriminants and pass their actual
values into the typed issue collection. Runtime `segmentPoints` metadata remains
present even though the published crossing interfaces do not declare it; no
required public member was added and no data was deleted. Optional route and DRC
fields are assembled explicitly, retaining truthiness versus undefined checks,
zero values, existing-key overwrite order, omitted fields, metadata identity,
unchanged-object reuse and copied-object behavior.

Five new regression tests cover all four crossing variants, optional via holes
(including zero), terminal vias, through-obstacle metadata, same-layer points,
remote cache jumper fields, and DRC identity/remapping metadata. All 28 type-only
files in this continuation emit identical minified JavaScript; the other five
have the explicit construction changes tested above.

## Contract decisions requiring separate approval

These are concrete examples where a syntactic cleanup cannot justify changing
the existing contract. No option below has been implemented.

**Dynamic progress protocol.** `BaseSolver.step()` tests
`"computeProgress" in this`, then uses a TypeScript ignore and asserts the call
result to `number`. The base class does not declare that method. A method merely
being present does not prove it is callable or returns a number. Options are to
retain the active finding, define and review an optional typed solver protocol,
or validate the method and return value with specified failure behavior. Adding
a mandatory method or silently skipping an invalid one changes extension behavior.

**Precise geometry returns.** `getMidpoint(p1, p2): { x: number; y: number }`
is flagged as anonymous-object widening despite retaining both coordinate fields.
Removing the explicit published return annotation or inventing a one-use alias
only evades the syntactic policy. Options are to retain the finding, adopt an
existing shared point contract through a reviewed API change, or approve a narrow
exception for a justified precise contract.

**Legacy queue extensions.** Exported `PriorityQueue.Node` contains
`f: number` plus `[key: string]: any`. The queue only requires `f`, but clients
can construct and read extra fields through that exported type. Removing its
index signature breaks that use. Options are to retain the finding, deprecate the
legacy alias while introducing a typed extension contract, or approve the public
type change after checking consumers. Moving the escape hatch into an alias
does not establish safety.

**Arbitrary-object debug serialization.**
`sanitizeParamsForDownload(value: unknown): unknown` handles Date, Error, Map,
Set, functions, symbols, cycles and class instances. Its container allocator takes
`object` because the stack traverses arbitrary object values. Narrowing the input
to JSON would exclude values the debugger supports. Options are to retain the
active boundary findings, approve narrow serializer exceptions, or design a
validated named output contract while preserving arbitrary input support. Such
an output type is a published API decision, not a reason to remove runtime guards.

**External geometry and solver contracts.** The retained chained casts include
the power expander requiring `point.layer` where the local SRJ permits multilayer
`layers`, external solvers with a different lifecycle, and a keyboard event routed
through a mouse-placement handler. Choosing an arbitrary layer, manufacturing
missing lifecycle members or accepting nonexistent pointer coordinates changes
real behavior. See [the exact earlier findings](anti-slop-fixes.md) for the
locations and options.

The **43 remaining conditional spreads** are still a possible safe follow-up;
they are not blocked as public API conflicts. Examples include optional metadata
in Circuit JSON export, cache-version request fields and projected obstacles.
Some insert optional keys before later required keys, and some overwrite keys
copied from an existing record. Their focused fixtures must preserve those details.
There is no blanket suppression or claim that this queue has been completed.

## Evidence

The shared Mac benchmark wrapper serialized typecheck, tests, build and formatting.
Repository and tooling typechecks pass, as do **38 focused tests / 393 assertions**
across 27 files, including the **five Bun CLI tests / 124 assertions** and original
routing/SVG fixtures. Eight existing Bun snapshots pass; no original snapshot or
fixture changed. Biome checks the entire repository.

The ESM/declaration build passes. Published `dist/index.d.ts` is byte-for-byte
identical to `fc68d2b` (SHA-256
`70c3b442707c56334430b2febe0fdad133a69d726c6fe0c016ae5d1c1240d8a3`).
That previous head was already byte-identical to the stacked base. The complete
lint report has 453 files and 24 active rules. Counts and every remaining UTF-8
source span are refreshed at `2d57cee`; all 25 existing exception locations are
also refreshed. [The machine-readable verification record](anti-slop-full-follow-up.json)
includes each changed file's emission result.

These checks do not establish behavior for arbitrary getters, proxies or altered
array methods. No routing metric improvement, clean lint migration, merge or
release is claimed.
