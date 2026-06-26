import assert from 'node:assert/strict';
import {
  containsEntityLinks,
  extractCitationKeys,
  renderEntityLinks,
  renderMathText,
  renderTextWithCitations
} from '../src/lib/utils/math-text.js';

function assertIncludes(haystack: string, needle: string, message: string) {
  assert.ok(haystack.includes(needle), `${message}\nExpected to include: ${needle}\nActual: ${haystack}`);
}

assert.equal(containsEntityLinks('See \\langref{CNF}'), true);
assert.equal(containsEntityLinks('See \\compilespoly{\\langref{CNF}}{\\langref{DNNF}}'), true);
assert.equal(containsEntityLinks('See \\nocompilesquasi{\\langref{CNF}}{\\langref{DNNF}}'), true);
assert.equal(containsEntityLinks('See \\defref{representation-language}'), false);
assert.equal(containsEntityLinks('Plain text only'), false);

const suffixedLang = renderEntityLinks(
  '\\langref{CNF}{s} and \\langfam{OBDD}{<}{s}',
  (id) => (id === 'lang_cnf' ? 'CNF' : id === 'lang_obdd_lt' ? 'OBDD$_<$' : id),
  undefined,
  (name) => (name === 'CNF' ? 'lang_cnf' : name === 'OBDD$_<$' || name === 'OBDD_<' ? 'lang_obdd_lt' : undefined)
);
assertIncludes(suffixedLang, 'href="/#lang/lang_cnf"', 'suffixed langref should keep the language target');
assertIncludes(suffixedLang, '>CNFs</a>', 'suffixed langref should include suffix inside the link label');
assertIncludes(suffixedLang, 'href="/#lang/lang_obdd_lt"', 'suffixed langfam should keep the family target');
assertIncludes(suffixedLang, '<sub>&lt;</sub>s</a>', 'suffixed langfam should render suffix after the subscript inside the link');

const relationHtml = renderEntityLinks(
  renderMathText('\\compilespoly{\\langfam{cSDD}{T}}{\\langref{d-SDNNF}}').html ?? '',
  (id) => (id === 'lang_csdd_t' ? 'cSDD$_T$' : id === 'lang_dsdnnf' ? 'd-SDNNF' : id),
  undefined,
  (name) => (
    name === 'cSDD$_T$' || name === 'cSDD_T'
      ? 'lang_csdd_t'
      : name === 'd-SDNNF'
        ? 'lang_dsdnnf'
        : undefined
  ),
  undefined,
  { edgeRefs: () => ['Example_2024'], edgeAssumption: () => 'P \\neq NP' }
);
assertIncludes(relationHtml, 'href="/#edge/lang_csdd_t/lang_dsdnnf"', 'relation macro should resolve both languages');
assertIncludes(relationHtml, 'cSDD<sub>T</sub> compiles to d-SDNNF in polynomial time', 'relation macro should render a clean label');
assertIncludes(relationHtml, 'assuming <span class="katex"', 'relation macro should render edge assumptions');
assertIncludes(relationHtml, '\\citep{Example_2024}', 'relation macro should append missing edge citations');

const noQuasiHtml = renderEntityLinks(
  '\\nocompilesquasi{\\langref{CNF}}{\\langref{DNNF}}',
  (id) => (id === 'lang_cnf' ? 'CNF' : id === 'lang_dnnf' ? 'DNNF' : id),
  undefined,
  (name) => (name === 'CNF' ? 'lang_cnf' : name === 'DNNF' ? 'lang_dnnf' : undefined)
);
assertIncludes(noQuasiHtml, 'CNF does not compile to DNNF in quasipolynomial time', 'negative relation macro should render precise text');

const operationHtml = renderEntityLinks(
  renderMathText('\\supportspoly{\\langref{CNF}}{\\VA}').html ?? '',
  (id) => (id === 'lang_cnf' ? 'CNF' : id),
  undefined,
  (name) => (name === 'CNF' ? 'lang_cnf' : undefined),
  undefined,
  {
    operationCode: (macro) => (macro === '\\VA' ? 'VA' : undefined),
    operationLabel: (macro) => (macro === '\\VA' ? 'Validity' : macro),
    operationRefs: () => ['Darwiche_2002'],
    operationAssumption: () => 'P \\neq NP'
  }
);
assertIncludes(operationHtml, 'href="/#op/lang_cnf/VA"', 'operation result macro should link to the operation cell');
assertIncludes(operationHtml, 'CNF supports Validity in polynomial time', 'operation result macro should render readable support prose');
assertIncludes(operationHtml, 'assuming <span class="katex"', 'operation result macro should render assumptions');
assertIncludes(operationHtml, '\\citep{Darwiche_2002}', 'operation result macro should append missing operation citations');

const renderedHash = renderMathText('This is \\#P-complete.').html ?? '';
assertIncludes(renderedHash, '#P-complete', 'escaped # should render without a leading backslash');
assert.equal(renderedHash.includes('\\#P'), false, 'escaped # should not keep the backslash in HTML output');

const renderedBareAssumption = renderMathText('assuming P \\neq NP').html ?? '';
assertIncludes(renderedBareAssumption, 'katex', 'bare P \\neq NP should render as inline math');
assert.equal(
  renderMathText('assuming $P \\neq NP$').html,
  renderedBareAssumption,
  'already-delimited P \\neq NP should not be double-wrapped'
);

const mixedLatex = renderMathText(
  '\\langref{PI} counting is \\#P-hard \\citet{Roth_1996}.'
).html ?? '';
const mixedLatexWithLinks = renderEntityLinks(
  renderTextWithCitations(mixedLatex, (key) => (key === 'Roth_1996' ? 35 : null)),
  (id) => (id === 'lang_pi' ? 'PI' : id),
  undefined,
  (name) => (name === 'PI' ? 'lang_pi' : undefined)
);
assertIncludes(mixedLatexWithLinks, '#P-hard', 'escaped # should decode in mixed LaTeX text');
assert.equal(mixedLatexWithLinks.includes('\\#P'), false, 'mixed output should not contain escaped #');
assertIncludes(mixedLatexWithLinks, 'data-entity-type="lang"', 'language links should still render in mixed output');
assertIncludes(mixedLatexWithLinks, 'citation-inline', '\\citet should render inline');
assertIncludes(mixedLatexWithLinks, 'data-citation-key="Roth_1996"', 'citations should still render in mixed output');

assert.deepEqual(
  extractCitationKeys('\\citet[Theorem 4.2]{Foo_2020,Bar_2021} and \\citep{Baz_2022}'),
  ['Foo_2020', 'Bar_2021', 'Baz_2022'],
  'optional citation arguments should not affect key extraction'
);

const textualCitation = renderTextWithCitations(
  renderMathText('\\citet[Theorem 4.2]{Foo_2020,Bar_2021}').html ?? '',
  (key) => (key === 'Foo_2020' ? 12 : key === 'Bar_2021' ? 13 : null)
);
assertIncludes(textualCitation, 'citation-inline', '\\citet should render as an inline citation');
assertIncludes(textualCitation, 'Theorem 4.2', '\\citet optional postnotes should render inline');
assertIncludes(textualCitation, 'data-citation-key="Foo_2020"', 'first textual citation key should be clickable');
assertIncludes(textualCitation, 'data-citation-key="Bar_2021"', 'second textual citation key should be clickable');

const parentheticalCitation = renderTextWithCitations(
  renderMathText('\\citep[Theorem 4.2]{Foo_2020}').html ?? '',
  (key) => (key === 'Foo_2020' ? 12 : null)
);
assertIncludes(parentheticalCitation, 'citation-sup', '\\citep should render as a superscript citation');
assert.equal(
  parentheticalCitation.includes('Theorem 4.2'),
  false,
  '\\citep optional postnotes should not render in the superscript citation'
);

console.log('math-text entity checks passed');
