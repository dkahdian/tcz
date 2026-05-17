/-
  TCZ.Basic — Core definitions for the Tractable Circuit Zoo formalization.

  This file defines:
  - The `Language` inductive (one constructor per KC language)
  - The `Operation` inductive (one constructor per query/transformation)
  - Opaque relation declarations: compilesInPoly, compilesInQuasi, supportsInPoly, supportsInQuasi
  - Structural metatheorems (axioms about polynomial/quasipolynomial computation)

  These are mathematical truths about polynomial-time computation, not specific
  to the TCZ data. They form the trusted kernel of the proof system.
-/

/-- Knowledge compilation language classes from the Tractable Circuit Zoo. -/
inductive Language where
  | anf           -- ANF
  | bdd           -- BDD
  | cnf           -- CNF
  | csdd          -- cSDD
  | d_dnnf        -- d-DNNF
  | d_sdnnf       -- d-SDNNF
  | d_sdnnf_t     -- d-SDNNF_T
  | dnf           -- DNF
  | dnnf          -- DNNF
  | fbdd          -- FBDD
  | ip            -- IP
  | mods          -- MODS
  | nfbdd         -- nFBDD
  | nnf           -- NNF
  | nobdd         -- nOBDD
  | nobdd_lt      -- nOBDD_<
  | obdd_lt       -- OBDD_<
  | pi            -- PI
  | sdd           -- SDD
  | sdd_t         -- SDD_T
  | sdnnf         -- SDNNF
  | sdnnf_t       -- SDNNF_T
  | ufbdd         -- uFBDD
  | uobdd         -- uOBDD
  | uobdd_lt      -- uOBDD_<
  | obdd          -- OBDD
  | dec_dnnf      -- dec-DNNF
  | dec_sdnnf     -- dec-SDNNF
  | dec_sdnnf_lt  -- dec-SDNNF_<
  | csdd_t        -- cSDD_T
  deriving DecidableEq, Repr

/-- Query and transformation operations from the Tractable Circuit Zoo. -/
inductive Operation where
  -- Queries
  | CO    -- Consistency
  | VA    -- Validity
  | CE    -- Clausal Entailment
  | IM    -- Implicant
  | EQ    -- Equivalence
  | SE    -- Sentential Entailment
  | CT    -- Model Counting
  | ME    -- Model Enumeration
  -- Transformations
  | CD      -- Conditioning
  | FO      -- Forgetting
  | SFO     -- Singleton Forgetting
  | AND_C   -- Conjunction
  | AND_BC  -- Bounded Conjunction
  | OR_C    -- Disjunction
  | OR_BC   -- Bounded Disjunction
  | NOT_C   -- Negation
  deriving DecidableEq, Repr

-- ===========================================================================
-- Core relations (opaque — their meaning comes from the axioms below)
-- ===========================================================================

/-- Language `a` can be compiled to language `b` in polynomial time. -/
axiom compilesInPoly (a b : Language) : Prop

/-- Language `a` can be compiled to language `b` in quasipolynomial time. -/
axiom compilesInQuasi (a b : Language) : Prop

/-- Language `l` supports operation `op` in polynomial time. -/
axiom supportsInPoly (l : Language) (op : Operation) : Prop

/-- Language `l` supports operation `op` in quasipolynomial time. -/
axiom supportsInQuasi (l : Language) (op : Operation) : Prop

-- ===========================================================================
-- Structural metatheorems (mathematical truths about poly/quasi computation)
-- ===========================================================================

/-- Transitivity of polynomial compilation. -/
axiom poly_trans {a b c : Language} :
  compilesInPoly a b → compilesInPoly b c → compilesInPoly a c

/-- Transitivity of quasipolynomial compilation. -/
axiom quasi_trans {a b c : Language} :
  compilesInQuasi a b → compilesInQuasi b c → compilesInQuasi a c

/-- Polynomial compilation implies quasipolynomial compilation. -/
axiom poly_implies_quasi {a b : Language} :
  compilesInPoly a b → compilesInQuasi a b

/-- If you can compile L1→L2 in poly and L2 supports a query in poly, then L1 does too. -/
axiom query_via_poly {a b : Language} {op : Operation} :
  compilesInPoly a b → supportsInPoly b op → supportsInPoly a op

/-- If you can compile L1→L2 in quasi and L2 supports a query in quasi, then L1 does too. -/
axiom query_via_quasi {a b : Language} {op : Operation} :
  compilesInQuasi a b → supportsInQuasi b op → supportsInQuasi a op

/-- Polynomial operation support implies quasipolynomial operation support. -/
axiom poly_support_implies_quasi {l : Language} {op : Operation} :
  supportsInPoly l op → supportsInQuasi l op
