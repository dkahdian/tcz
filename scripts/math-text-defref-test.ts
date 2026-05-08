import assert from 'node:assert/strict';
import {
  containsEntityLinks,
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

// Definition id resolution should link to the Definitions page anchor.
const byId = renderEntityLinks(
  'Refer to \\defref{representation-language}.',
  (id) => id,
  undefined,
  undefined,
  resolveDefinitionRef
);
assertIncludes(byId, 'href="/definitions#representation-language"', 'definition id should link to /definitions#id');
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
assertIncludes(customLabel, 'href="/definitions#representation-language"', 'custom label should keep the first argument as the link target');
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
assertIncludes(byTitle, 'href="/definitions#language-family"', 'definition title should link to the matching definition id');
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
assertIncludes(latexTitle, 'href="/definitions#transformation-and-c"', 'latex definition title should link to /definitions#id');
assertIncludes(latexTitle, 'katex', 'latex definition title should render KaTeX markup');
assert.equal(latexTitle.includes('$\\wedge$C'), false, 'latex definition title should not expose raw math delimiters');

const latexCustomLabel = renderEntityLinks(
  'See \\defref{transformation-and-c}{Conjunction ($\\wedge$C)}.',
  (id) => id,
  undefined,
  undefined,
  resolveDefinitionRef
);
assertIncludes(latexCustomLabel, 'href="/definitions#transformation-and-c"', 'latex custom label should link to /definitions#id');
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

// Escaped LaTeX literals in prose should render as plain characters.
const renderedHash = renderMathText('This is \\#P-complete.').html ?? '';
assertIncludes(renderedHash, '#P-complete', 'escaped # should render without a leading backslash');
assert.equal(renderedHash.includes('\\#P'), false, 'escaped # should not keep the backslash in HTML output');

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
assertIncludes(mixedLatexWithLinks, '[35]', 'citations should still render in mixed output');

console.log('math-text defref checks passed');
