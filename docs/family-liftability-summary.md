Class-Level Liftability Summary (2026-04-30)

Lifted results added explicitly:

| Union-level source result | Added class-level result | Status | Main justification |
| --- | --- | --- | --- |
| dec-SDNNF -> OBDD | dec-SDNNF_T -> OBDD_< | no-poly-quasi | Common-order quasipolynomial simulation from quasi-note.tex; polynomial lower bound lifts through OBDD_< -> FBDD. |
| SDNNF -> nOBDD | SDNNF_T -> nOBDD_< | no-poly-quasi | Common-order quasipolynomial simulation from quasi-note.tex; polynomial lower bound lifts through d-SDNNF_T -> SDNNF_T and nOBDD_< -> nFBDD. |
| d-SDNNF -> uOBDD | d-SDNNF_T -> uOBDD_< | no-poly-quasi | Deterministic corollary of the common-order simulation in quasi-note.tex; polynomial lower bound lifts through uOBDD_< -> nFBDD. |
| SDD -> FBDD | SDD_T -> FBDD | no-quasi | The class-level lower bound is stronger: SDD_T -> SDD -> FBDD would contradict it. |
| uOBDD -> OBDD | uOBDD_< -> OBDD_< | no-quasi | HWB has polynomial fixed-order uOBDD representations, while Bryant/Wegener give order-independent OBDD lower bounds. |
| cSDD -> OBDD | cSDD_T -> OBDD_< | no-quasi | Bova's generalized-HWB construction gives small compressed SDDs respecting vtrees; OBDD lower bounds are order-independent. |
| d-SDNNF -> SDD | d-SDNNF_T -> SDD_T | no-poly-unknown-quasi | Vinall-Smeeth's source circuits are structured d-DNNFs respecting a fixed vtree, and the lower bound is against every SDD. |

Family subset edges added explicitly:

| Union-level source result | Added class-level result | Status | Main justification |
| --- | --- | --- | --- |
| OBDD -> uOBDD | OBDD_< -> uOBDD_< | poly | A deterministic fixed-order OBDD is an unambiguous fixed-order OBDD under the same order. |
| uOBDD -> nOBDD | uOBDD_< -> nOBDD_< | poly | An unambiguous fixed-order OBDD is a nondeterministic fixed-order OBDD under the same order. |
