/**
 * Canonical language ordering for matrix views.
 *
 * Computed once from the current dataset to keep polynomial edges
 * upper-triangular in the succinctness matrix.
 *
 * Languages not in this map are appended alphabetically.
 */

export const CANONICAL_ORDER: Record<string, number> = {
	'lang_5bf00851': 0, // NNF
	'lang_3bebcab7': 1, // DNNF
	'lang_1df07cc3': 2, // nFBDD
	'lang_b13b0d78': 3, // SDNNF
	'lang_3c803ba1': 4, // SDNNF_T
	'lang_6c130090': 5, // d-DNNF
	'lang_d24efe0e': 6, // nOBDD
	'lang_e827cf31': 7, // nOBDD_<
	'lang_4e62a038': 8, // uFBDD
	'lang_ea9b5299': 9, // d-SDNNF
	'lang_91f812d0': 10, // d-SDNNF_T
	'lang_981b62f0': 11, // dec-DNNF
	'lang_684b1ca7': 12, // FBDD
	'lang_c2df8c2b': 13, // uOBDD
	'lang_43a33aec': 14, // uOBDD_<
	'lang_1afefbe2': 15, // SDD
	'lang_9c84a267': 16, // SDD_T
	'lang_83e3b023': 17, // cSDD
	'lang_82fa749e': 18, // cSDD_T
	'lang_0f27d539': 19, // dec-SDNNF
	'lang_4ae03bc8': 20, // dec-SDNNF_T
	'lang_b9d72a7c': 21, // OBDD
	'lang_d7403a53': 22, // TDD
	'lang_d69995dd': 23, // OBDD_<
	'lang_8cf1da0e': 24, // TDD_T
	'lang_89649e36': 25, // CNF
	'lang_27fffab2': 26, // PI
	'lang_4c204bf3': 27, // DNF
	'lang_6ae90adc': 28, // IP
	'lang_e02902d0': 29 // MODS
};

/**
 * Compare two language IDs by canonical order, with alphabetical fallback.
 * @param getName - function to get a language's display name from its ID
 */
export function compareByCanonicalOrder(
	a: string,
	b: string,
	getName: (id: string) => string
): number {
	const pa = CANONICAL_ORDER[a] ?? 1000;
	const pb = CANONICAL_ORDER[b] ?? 1000;
	if (pa !== pb) return pa - pb;
	return getName(a).localeCompare(getName(b));
}
