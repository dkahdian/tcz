import assert from 'node:assert/strict';
import {
  containsEntityLinks,
  extractCitationKeys,
  renderEntityLinks,
  renderMathText,
  renderTextWithCitations
} from '../src/lib/utils/math-text.js';

type Definition = { id: string; title: string };

const definitions: Definition[] = [
  { id: 'representation-language', title: 'Representation Language' },
  { id: 'language-family', title: 'Language Family' },
  { id: 'transformation-and-c', title: 'Conjunction ($\\wedge$C)' }
];

const definitionLookup = new Map(definitions.map((definition) => [definition.id, definition]));
const definitionTitleLookup = new Map(
  definitions.map((definition) => [definition.title.toLowerCase(), definition.id])
);

function resolveDefinitionRef(ref: string): { id: string; title: string; resolved: boolean } {
  const normalized = ref.trim();
  const byId = definitionLookup.get(normalized);
  if (byId) {
    return { id: byId.id, title: byId.title, resolved: true };
  }

  const byTitleId = definitionTitleLookup.get(normalized.toLowerCase());
  if (byTitleId) {
    const definition = definitionLookup.get(byTitleId);
    if (definition) {
      return { id: definition.id, title: definition.title, resolved: true };
    }
  }

  return { id: normalized, title: normalized, resolved: false };
}

function assertIncludes(haystack: string, needle: string, message: string) {
  assert.ok(haystack.includes(needle), `${message}\nExpected to include: ${needle}\nActual: ${haystack}`);
}

// containsEntityLinks should recognize defref alongside the existing link commands.
assert.equal(containsEntityLinks('See \\defref{representation-language}'), true);
assert.equal(containsEntityLinks('See \\langref{CNF}'), true);
assert.equal(containsEntityLinks('See \\edgeref{a}{b}'), true);
assert.equal(containsEntityLinks('See \\opref{a}{CO}'), true);
assert.equal(containsEntityLinks('Plain text only'), false);

// Definition id resolution should link to the About page anchor.
const byId = renderEntityLinks(
  'Refer to \\defref{representation-language}.',
  (id) => id,
  undefined,
  undefined,
  resolveDefinitionRef
);
assertIncludes(byId, 'href="/about#representation-language"', 'definition id should link to /about#id');
assertIncludes(byId, '>Representation Language<', 'definition id should render the canonical title');
assertIncludes(byId, '<strong>Representation Language</strong>', 'definition link label should render bold');

// A second braced argument should override the visible link label while preserving the target.
const customLabel = renderEntityLinks(
  'Refer to \\defref{representation-language}{representation languages}.',
  (id) => id,
  undefined,
  undefined,
  resolveDefinitionRef
);
assertIncludes(customLabel, 'href="/about#representation-language"', 'custom label should keep the first argument as the link target');
assertIncludes(customLabel, '<strong>representation languages</strong>', 'custom label should render as bold link text');
assert.equal(customLabel.includes('>Representation Language<'), false, 'custom label should not render the canonical title');

// Title fallback should resolve to the same anchor.
const byTitle = renderEntityLinks(
  'Refer to \\defref{Language Family}.',
  (id) => id,
  undefined,
  undefined,
  resolveDefinitionRef
);
assertIncludes(byTitle, 'href="/about#language-family"', 'definition title should link to the matching definition id');
assertIncludes(byTitle, '>Language Family<', 'definition title should render the canonical title');

// Definition link labels can contain inline LaTeX and should render it instead of
// exposing raw delimiters.
const latexTitle = renderEntityLinks(
  'See \\defref{transformation-and-c}.',
  (id) => id,
  undefined,
  undefined,
  resolveDefinitionRef
);
assertIncludes(latexTitle, 'href="/about#transformation-and-c"', 'latex definition title should link to /about#id');
assertIncludes(latexTitle, 'katex', 'latex definition title should render KaTeX markup');
assert.equal(latexTitle.includes('$\\wedge$C'), false, 'latex definition title should not expose raw math delimiters');

const latexCustomLabel = renderEntityLinks(
  'See \\defref{transformation-and-c}{Conjunction ($\\wedge$C)}.',
  (id) => id,
  undefined,
  undefined,
  resolveDefinitionRef
);
assertIncludes(latexCustomLabel, 'href="/about#transformation-and-c"', 'latex custom label should link to /about#id');
assertIncludes(latexCustomLabel, '<strong>', 'latex custom label should be bold');
assertIncludes(latexCustomLabel, 'katex', 'latex custom label should render KaTeX markup');

// Missing references should stay visible instead of breaking rendering.
const missing = renderEntityLinks(
  'Refer to \\defref{missing-definition}.',
  (id) => id,
  undefined,
  undefined,
  resolveDefinitionRef
);
assertIncludes(missing, 'entity-link--unknown', 'missing definition should render a visible unknown marker');
assertIncludes(missing, '[?]', 'missing definition should render a visible marker');

// Existing link types should continue to work.
const mixed = renderEntityLinks(
  '\\langref{CNF} \\edgeref{lang_a}{lang_b} \\opref{lang_a}{CO}',
  (id) => (id === 'lang_cnf' ? 'CNF' : id),
  (code) => code,
  (name) => (name === 'CNF' ? 'lang_cnf' : undefined),
  resolveDefinitionRef
);
assertIncludes(mixed, 'data-entity-type="lang"', 'language links should still render');
assertIncludes(mixed, 'data-entity-type="edge"', 'edge links should still render');
assertIncludes(mixed, 'data-entity-type="op"', 'operation links should still render');

const suffixedLang = renderEntityLinks(
  '\\langref{CNF}{s} and \\langfam{OBDD}{<}{s}',
  (id) => (id === 'lang_cnf' ? 'CNF' : id === 'lang_obdd_lt' ? 'OBDD$_<$' : id),
  undefined,
  (name) => (name === 'CNF' ? 'lang_cnf' : name === 'OBDD$_<$' || name === 'OBDD_<' ? 'lang_obdd_lt' : undefined),
  resolveDefinitionRef
);
assertIncludes(suffixedLang, 'href="/#lang/lang_cnf"', 'suffixed langref should keep the language target');
assertIncludes(suffixedLang, '>CNFs</a>', 'suffixed langref should include suffix inside the link label');
assertIncludes(suffixedLang, 'href="/#lang/lang_obdd_lt"', 'suffixed langfam should keep the family target');
assertIncludes(suffixedLang, '<sub>&lt;</sub>s</a>', 'suffixed langfam should render suffix after the subscript inside the link');

// Entity commands should protect math delimiters inside their arguments until
// entity-link rendering resolves the full macro.
const indexedEdgeHtml = renderEntityLinks(
  renderMathText('\\edgeref{cSDD$_T$}{d-SDNNF}').html ?? '',
  (id) => (id === 'lang_csdd_t' ? 'cSDD$_T$' : id === 'lang_dsdnnf' ? 'd-SDNNF' : id),
  undefined,
  (name) => (
    name === 'cSDD$_T$' || name === 'cSDD_T'
      ? 'lang_csdd_t'
      : name === 'd-SDNNF'
        ? 'lang_dsdnnf'
        : undefined
  ),
  resolveDefinitionRef
);
assertIncludes(indexedEdgeHtml, 'href="/#edge/lang_csdd_t/lang_dsdnnf"', 'indexed edgeref should resolve both languages');
assertIncludes(indexedEdgeHtml, 'cSDD<sub>T</sub> compiles to d-SDNNF', 'indexed edgeref should render a clean label');
assert.equal(indexedEdgeHtml.includes('katex'), false, 'indexed edgeref should not inject KaTeX internals into the macro label');

// Escaped LaTeX literals in prose should render as plain characters.
const renderedHash = renderMathText('This is \\#P-complete.').html ?? '';
assertIncludes(renderedHash, '#P-complete', 'escaped # should render without a leading backslash');
assert.equal(renderedHash.includes('\\#P'), false, 'escaped # should not keep the backslash in HTML output');

// Common bare complexity assumptions in generated prose should render as math.
const renderedBareAssumption = renderMathText('assuming P \\neq NP').html ?? '';
assertIncludes(renderedBareAssumption, 'katex', 'bare P \\neq NP should render as inline math');
assert.equal(
  renderMathText('assuming $P \\neq NP$').html,
  renderedBareAssumption,
  'already-delimited P \\neq NP should not be double-wrapped'
);

// Mixed prose + entity/citation commands should preserve command processing while decoding \#.
const mixedLatex = renderMathText(
  '\\langref{PI} counting is \\#P-hard \\citet{Roth_1996}.'
).html ?? '';
const mixedLatexWithLinks = renderEntityLinks(
  renderTextWithCitations(mixedLatex, (key) => (key === 'Roth_1996' ? 35 : null)),
  (id) => (id === 'lang_pi' ? 'PI' : id),
  undefined,
  (name) => (name === 'PI' ? 'lang_pi' : undefined),
  resolveDefinitionRef
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

console.log('math-text defref checks passed');
