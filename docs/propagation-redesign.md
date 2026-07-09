# Propagation Redesign

This document specifies the replacement for the old propagation route.
The goal is to separate mathematical fact discovery from human-readable proof
construction.

The current propagator mixes four concerns:

- reading authored data;
- expanding batch claims;
- deriving all consequences;
- writing proof traces and descriptions.

The new architecture separates these concerns into three modules:

```text
facts/   atomic fact types, fact tables, origin metadata, filtering
derive/  fixed-point fact saturation
prove/   targeted proof search and proof certification
```

Lean generation and `derivationOrder` have been removed from the route.
Proofs are human-facing certificates used for descriptions, validation, and
debugging.

## Core Principle

Propagation is a map from partial data to full data:

```text
authored database -> candidate fact closure -> certified fact closure -> serialized database
```

The derivation engine computes every candidate fact. It does not write
descriptions and does not try to choose human-readable witnesses.

The proof engine then certifies each candidate fact using deterministic,
rule-specific proof search. A candidate fact must be certifiable before it can
be serialized.

## Atomic Facts

The derivation engine operates on atomic facts rather than serialized statuses.

```text
LeP(A, B)          A compiles to B with polynomial blowup
LeQ(A, B)          A compiles to B with quasipolynomial blowup
NotLeP(A, B)       A does not compile to B with polynomial blowup
NotLeQ(A, B)       A does not compile to B with quasipolynomial blowup

SupportsP(L, Op)   L supports query/transform Op in polynomial time
NotSupportsP(L,Op) L does not support query/transform Op in polynomial time

BatchApplies(B, L) batch claim B applies to language L
```

Queries and transforms no longer track quasipolynomial detail. Quasi remains
part of succinctness edges only.

Serialized statuses are views over these atoms. For example:

```text
LeP(A,B) + LeQ(A,B)                 -> poly
LeQ(A,B), no LeP(A,B)               -> unknown-poly-quasi
NotLeP(A,B), no LeQ/NotLeQ(A,B)     -> no-poly-unknown-quasi
NotLeP(A,B) + LeQ(A,B)              -> no-poly-quasi
NotLeQ(A,B)                         -> no-quasi
```

## Fact Origins

Every fact has an origin:

```text
authored  directly entered as an individual claim
batch     materialized from an authored batch claim
derived   inferred by propagation rules
```

For compatibility with old data, origin can be inferred from the legacy schema:

```text
batchId present -> batch
derived true    -> derived
otherwise       -> authored
```

Origin is serialized as a first-class field on generated facts.

Batch facts rank below direct authored facts but above derived facts when
choosing readable proofs. A batch fact is available only after its
`BatchApplies` fact has been certified.

## Assumptions

Assumptions are intended to be strongly believed hypotheses. They do not weaken
facts for derivation or contradiction detection.

Therefore this is a real contradiction:

```text
LeP(A,B) under H1
NotLeP(A,B) under H2
```

The derivation engine ignores assumptions while discovering candidate facts.
The proof engine tracks assumptions only to decide whether a proof is clean or
dirty and to serialize the final assumption text.

```text
clean proof  uses no assumption-bearing premise
dirty proof  uses at least one assumption-bearing premise
```

## Candidate Derivation

The derivation engine computes the least fixed point of the fact rules.
Rules are monotone: they only add facts.

The key succinctness rules are:

```text
LeP(A,C) :-
  LeP(A,B),
  LeP(B,C).

LeQ(A,C) :-
  LeQ(A,B),
  LeQ(B,C).

LeQ(A,B) :-
  LeP(A,B).

NotLeP(X,Y) :-
  LeP(C,X),
  NotLeP(C,D),
  LeP(Y,D).

NotLeQ(X,Y) :-
  LeQ(C,X),
  NotLeQ(C,D),
  LeQ(Y,D).
```

The last two rules replace the current trial-mutation contradiction search.

Query transfer through compilation:

```text
SupportsP(A,Q) :-
  LeP(A,B),
  SupportsP(B,Q).

NotSupportsP(B,Q) :-
  LeP(A,B),
  NotSupportsP(A,Q).
```

Query separation:

```text
NotLeP(B,A) :-
  SupportsP(A,Q),
  NotSupportsP(B,Q).
```

Operation lemmas:

```text
SupportsP(L,C) :-
  SupportsP(L,A1),
  ...,
  SupportsP(L,An),
  Lemma(A1,...,An => C).
```

Contrapositive operation lemmas:

```text
NotSupportsP(L,Aj) :-
  NotSupportsP(L,C),
  SupportsP(L,A1),
  ...,
  SupportsP(L,A(j-1)),
  SupportsP(L,A(j+1)),
  ...,
  SupportsP(L,An),
  Lemma(A1,...,An => C).
```

Batch rules:

```text
BatchApplies(B,L) :-
  selector condition for B holds on L.

SupportsP(L,Op) :-
  BatchApplies(B,L),
  batch B asserts Op is supported.

NotSupportsP(L,Op) :-
  BatchApplies(B,L),
  batch B asserts Op is unsupported.
```

Batch selectors must support language-list selectors, edge-fact selectors,
query selectors, transform selectors, and the boolean combinations supported by
the schema.

Contradiction detection is direct:

```text
LeP(A,B) and NotLeP(A,B)             -> error
LeQ(A,B) and NotLeQ(A,B)             -> error
SupportsP(L,Op) and NotSupportsP(L,Op) -> error
```

## Proof Certification

Proof certification is a fixed point over available proofs, not over
mathematical truth. Candidate truth has already been computed by derivation.

The proof engine supports cold starts. Existing serialized proofs may be reused
if they are still valid. Invalidated proofs are discarded and recomputed.

### Certification Order

1. Derive all candidate facts.
2. Verify all existing proofs. Keep valid proofs as old proofs and discard the
   rest.
3. Use every valid old proof that is clean and authored-only.
4. Prove remaining facts using clean authored-only premises.
5. Use every valid old proof that is clean and uses authored plus batch
   premises.
6. Run the clean authored-plus-batch fixed point.
7. Use every valid old proof that is clean and may use authored, batch, and
   derived premises.
8. Run the clean authored-plus-batch-plus-derived fixed point.
9. Repeat the same sequence for dirty proofs.
10. Throw an error if any candidate fact remains uncertified.

The fixed-point loop for a tier is simple:

```text
repeat:
  for each uncertified candidate fact:
    try to prove it using the current availability policy
until no new proofs are certified
```

Availability policy is defined by:

```text
clean or dirty
allowed origins: authored, authored+batch, or authored+batch+derived
currently certified facts
```

An "authored clean derived claim" means a derived candidate fact whose proof
uses only authored clean premises. It does not mean the candidate fact itself
was directly authored.

## Proof Algorithms

Each proof search is deterministic. Inputs and outputs should be ordered by
stable IDs to avoid noisy diffs.

### Positive Succinctness

To prove `LeP(A,B)`, run BFS from `A` to `B` over available `LeP` edges.

To prove `LeQ(A,B)`, run BFS from `A` to `B` over available `LeQ` edges, where
available `LeP` edges also count as `LeQ`.

The proof is the discovered path.

### Negative Succinctness

To prove `NotLeP(X,Y)`, find an obstruction:

```text
C <=p X
NotLeP(C,D)
Y <=p D
```

If `X <=p Y` existed, then `C <=p X <=p Y <=p D`, contradicting
`NotLeP(C,D)`.

Algorithm:

```text
1. BFS backward from X over available LeP edges. Record dist(C,X).
2. BFS forward from Y over available LeP edges. Record dist(Y,D).
3. Scan available NotLeP(C,D) obstruction facts.
4. Pick the reachable obstruction minimizing dist(C,X) + dist(Y,D).
5. Reconstruct the two positive paths and render the contradiction.
```

Worst-case runtime is `O(m + k)` per proof, where `m` is the number of
available positive edges and `k` is the number of available negative
obstructions in the current tier. With dense matrices this is `O(n^2)` in the
number of languages.

`NotLeQ(X,Y)` uses the same algorithm with quasi edges and `NotLeQ`
obstructions.

### Query By Compiling

Positive query transfer:

```text
SupportsP(A,Q)
```

is proved by finding a path `A <=p B` plus an available leaf proof of
`SupportsP(B,Q)`.

Negative query transfer:

```text
NotSupportsP(B,Q)
```

is proved by finding a path `A <=p B` plus an available leaf proof of
`NotSupportsP(A,Q)`. If `B` supported the query, then `A` could compile to `B`
and run it there.

Both searches use BFS under the current availability policy.

### Query Separation

To prove:

```text
NotLeP(B,A)
```

find a query `Q` such that:

```text
SupportsP(A,Q)
NotSupportsP(B,Q)
```

The search uses the same clean/dirty and origin-tier availability policy as all
other proof algorithms. There is no special query-specific tiering.

### Operation Lemmas

Forward lemma proofs use the existing structure:

```text
prove all antecedent operation facts
cite the lemma
conclude the consequent
```

Contrapositive lemma proofs use:

```text
prove the consequent is unsupported
prove every other antecedent is supported
cite the lemma
conclude the remaining antecedent is unsupported
```

### Batch Facts

A batch fact is proved by:

```text
authored batch claim
proof that BatchApplies(B,L)
```

If the selector depends on another fact, prove that selector fact using the
current availability policy.

## Serialization

After proof certification, serialize certified atomic facts back into the
current database shape.

Partially derived statuses remain component-wise. For example, `no-poly-quasi`
may have an authored quasi component and a derived no-poly component.

Generated descriptions should be built from certified proofs, not from the
derivation engine's internal discovery order.

Sandbox previews may use lazy serialization. In lazy mode, propagation runs
candidate derivation and contradiction detection, then serializes semantic
statuses without proof certificates or generated proof prose. Canonical scripts
must keep using eager mode so persisted data remains proof-rich.

Changed-cell detection in sandbox mode is semantic: succinctness cells compare
status and assumption, while operation cells compare complexity and assumption.
Reference-list and description-only changes do not mark cells as changed.

The next natural extension is targeted proof hydration. The propagation engine
can accept a small target list, often a singleton corresponding to the claim the
user opened, and run proof certification only until those target claims are
certified. This is separate from sandbox preview latency and can be triggered on
claim expansion or in the background after a lazy preview.

## Testing Plan

The first compatibility target is atomic closure parity:

```text
old propagation statuses == new propagation statuses
```

Descriptions and proof text may change after parity is established, but fact
statuses should match unless a difference is intentional.

Implementation checklist:

1. Extract authored database facts into atomic tables.
2. Implement candidate derivation and compare closure against current
   propagation.
3. Implement proof certification for succinctness edges.
4. Implement proof certification for queries, transforms, operation lemmas, and
   batches.
5. Serialize certified facts into the existing database shape.
6. Remove the old route, Lean generation, and `derivationOrder` metadata.
