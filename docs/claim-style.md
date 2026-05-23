# Claim Style Notes

Use citation commands for paper attribution. Prefer `\citet{...}` or `\citep{...}` over plaintext author names in claim descriptions.

Use entity/reference commands for claim objects. Prefer `\langref{...}`, `\langfam{...}{...}`, `\edgeref{...}{...}`, `\nedgeref{...}{...}`, `\opref{...}{...}`, and `\nopref{...}{...}` over plaintext language or claim names. For plural prose, use the suffix form inside the language command, e.g. `\langref{OBDD}{s}` or `\langfam{OBDD}{<}{s}`.

Keep claim descriptions concise. Justify the direct claim at hand; avoid extra context that is only interesting background.

For statuses combining an upper and lower bound, describe only the non-propagated/direct part when the other side is already handled by propagation.

Use `TCZ_Forthcoming` only for TCZ-specific internal lemmas or constructions that do not have an adequate public citation. Do not add it to generic reductions or claims already supported by a primary source.

Do not expose internal filenames such as `quasi-note.tex` or `transformation-notes.tex` in frontend-visible prose.
