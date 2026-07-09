import type { OperationLemma } from '../../../types.js';
import { OPERATION_LEMMAS } from '../../query-lemmas.js';
import {
  addFact,
  atomKey,
  batchAtom,
  edgeAtom,
  type FactContext,
  type FactTables,
  hasFact,
  isQueryCode,
  opAtom,
  opAssertsNoPoly,
  opGuaranteesPoly,
  operationTypeForCode,
  resolveBatchLanguageRef,
  selectorForBatch
} from '../facts/index.js';

function languageCount(context: FactContext): number {
  return context.languageIds.length;
}

export function deriveCandidateFacts(context: FactContext, tables: FactTables): FactTables {
  const n = languageCount(context);
  let changed = true;

  while (changed) {
    changed = false;
    changed = derivePositiveSuccinctness(context, tables) || changed;
    changed = deriveNegativeSuccinctness(context, tables) || changed;
    changed = deriveBatchFacts(context, tables) || changed;
    changed = deriveQueryFacts(context, tables) || changed;
    changed = deriveOperationLemmas(context, tables, OPERATION_LEMMAS) || changed;
    changed = deriveSuccinctnessFromQueries(context, tables) || changed;
    validateNoContradictions(context, tables);
  }

  for (let i = 0; i < n; i += 1) {
    tables.leP[i][i] = false;
    tables.leQ[i][i] = false;
  }

  return tables;
}

function derivePositiveSuccinctness(context: FactContext, tables: FactTables): boolean {
  const n = languageCount(context);
  let changed = false;

  for (let a = 0; a < n; a += 1) {
    for (let b = 0; b < n; b += 1) {
      if (a === b) continue;
      if (tables.leP[a][b]) {
        changed = addFact(tables, edgeAtom('leQ', a, b), 'derived', n) || changed;
        for (let c = 0; c < n; c += 1) {
          if (c !== a && c !== b && tables.leP[b][c]) {
            changed = addFact(tables, edgeAtom('leP', a, c), 'derived', n) || changed;
          }
        }
      }
      if (tables.leQ[a][b]) {
        for (let c = 0; c < n; c += 1) {
          if (c !== a && c !== b && tables.leQ[b][c]) {
            changed = addFact(tables, edgeAtom('leQ', a, c), 'derived', n) || changed;
          }
        }
      }
    }
  }

  return changed;
}

function deriveNegativeSuccinctness(context: FactContext, tables: FactTables): boolean {
  const n = languageCount(context);
  let changed = false;

  for (let c = 0; c < n; c += 1) {
    for (let d = 0; d < n; d += 1) {
      if (c === d) continue;

      if (tables.notLeQ[c][d]) {
        changed = addFact(tables, edgeAtom('notLeP', c, d), 'derived', n) || changed;
      }

      if (tables.notLeP[c][d]) {
        for (let x = 0; x < n; x += 1) {
          if (!reachesPoly(tables, c, x)) continue;
          for (let y = 0; y < n; y += 1) {
            if (x === y) continue;
            if (reachesPoly(tables, y, d)) {
              changed = addFact(tables, edgeAtom('notLeP', x, y), 'derived', n) || changed;
            }
          }
        }
      }

      if (tables.notLeQ[c][d]) {
        for (let x = 0; x < n; x += 1) {
          if (!reachesQuasi(tables, c, x)) continue;
          for (let y = 0; y < n; y += 1) {
            if (x === y) continue;
            if (reachesQuasi(tables, y, d)) {
              changed = addFact(tables, edgeAtom('notLeQ', x, y), 'derived', n) || changed;
            }
          }
        }
      }
    }
  }

  return changed;
}

function reachesPoly(tables: FactTables, source: number, target: number): boolean {
  return source === target || tables.leP[source]?.[target] === true;
}

function reachesQuasi(tables: FactTables, source: number, target: number): boolean {
  return source === target || tables.leQ[source]?.[target] === true || tables.leP[source]?.[target] === true;
}

function deriveBatchFacts(context: FactContext, tables: FactTables): boolean {
  const n = languageCount(context);
  let changed = false;

  for (let batchIndex = 0; batchIndex < context.batches.length; batchIndex += 1) {
    const batch = context.batches[batchIndex];
    const selector = selectorForBatch(batch);
    for (let language = 0; language < n; language += 1) {
      if (!selectorMatches(context, tables, language, selector)) continue;
      const applyAtom = batchAtom(batchIndex, language);
      changed = addFact(tables, applyAtom, 'batch', n) || changed;

      const op = batch.op;
      const operationType = operationTypeForCode(context, op);
      if (operationType !== batch.opType) continue;

      const fact = opGuaranteesPoly(batch.status)
        ? opAtom('supportsP', language, op)
        : opAssertsNoPoly(batch.status)
          ? opAtom('notSupportsP', language, op)
          : null;
      if (!fact) continue;
      const key = atomKey(fact);
      if (!context.batchSources.has(key)) context.batchSources.set(key, batchIndex);
      changed = addFact(tables, fact, 'batch', n) || changed;
    }
  }

  return changed;
}

function selectorMatches(
  context: FactContext,
  tables: FactTables,
  language: number,
  selector: ReturnType<typeof selectorForBatch>
): boolean {
  switch (selector.kind) {
    case 'list':
      return selector.languageIds.includes(context.languageIds[language]);
    case 'allOf':
      return selector.selectors.every((child) => selectorMatches(context, tables, language, child));
    case 'anyOf':
      return selector.selectors.some((child) => selectorMatches(context, tables, language, child));
    case 'edge': {
      const source = resolveBatchLanguageRef(context, language, selector.source);
      const target = resolveBatchLanguageRef(context, language, selector.target);
      if (source === undefined || target === undefined) return false;
      if (source === target) return (selector.polarity ?? 'positive') === 'positive';
      if ((selector.polarity ?? 'positive') === 'negative') {
        return selector.level === 'poly'
          ? tables.notLeP[source]?.[target] === true || tables.notLeQ[source]?.[target] === true
          : tables.notLeQ[source]?.[target] === true;
      }
      return selector.level === 'poly'
        ? reachesPoly(tables, source, target)
        : reachesQuasi(tables, source, target);
    }
    case 'operation': {
      const targetLanguage = resolveBatchLanguageRef(context, language, selector.language);
      if (targetLanguage === undefined) return false;
      return (selector.polarity ?? 'positive') === 'positive'
        ? tables.supportsP.get(selector.op)?.[targetLanguage] === true
        : tables.notSupportsP.get(selector.op)?.[targetLanguage] === true;
    }
  }
}

function deriveQueryFacts(context: FactContext, tables: FactTables): boolean {
  const n = languageCount(context);
  let changed = false;

  for (const op of context.operations.queryCodes) {
    const supports = tables.supportsP.get(op);
    const notSupports = tables.notSupportsP.get(op);
    for (let a = 0; a < n; a += 1) {
      for (let b = 0; b < n; b += 1) {
        if (a === b || !reachesPoly(tables, a, b)) continue;
        if (supports?.[b]) {
          changed = addFact(tables, opAtom('supportsP', a, op), 'derived', n) || changed;
        }
        if (notSupports?.[a]) {
          changed = addFact(tables, opAtom('notSupportsP', b, op), 'derived', n) || changed;
        }
      }
    }
  }

  return changed;
}

function deriveOperationLemmas(context: FactContext, tables: FactTables, lemmas: OperationLemma[]): boolean {
  const n = languageCount(context);
  let changed = false;

  for (let language = 0; language < n; language += 1) {
    for (const lemma of lemmas) {
      if (lemma.antecedent.every((op) => tables.supportsP.get(op)?.[language] === true)) {
        changed = addFact(tables, opAtom('supportsP', language, lemma.consequent), 'derived', n) || changed;
      }

      if (tables.notSupportsP.get(lemma.consequent)?.[language] === true) {
        for (const target of lemma.antecedent) {
          const othersSupported = lemma.antecedent
            .filter((op) => op !== target)
            .every((op) => tables.supportsP.get(op)?.[language] === true);
          if (othersSupported) {
            changed = addFact(tables, opAtom('notSupportsP', language, target), 'derived', n) || changed;
          }
        }
      }
    }
  }

  return changed;
}

function deriveSuccinctnessFromQueries(context: FactContext, tables: FactTables): boolean {
  const n = languageCount(context);
  let changed = false;

  for (const query of context.operations.queryCodes) {
    const supports = tables.supportsP.get(query);
    const notSupports = tables.notSupportsP.get(query);
    if (!supports || !notSupports) continue;
    for (let positive = 0; positive < n; positive += 1) {
      if (!supports[positive]) continue;
      for (let negative = 0; negative < n; negative += 1) {
        if (positive === negative || !notSupports[negative]) continue;
        changed = addFact(tables, edgeAtom('notLeP', negative, positive), 'derived', n) || changed;
      }
    }
  }

  return changed;
}

export function validateNoContradictions(context: FactContext, tables: FactTables): void {
  const n = languageCount(context);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      if (tables.leP[i][j] && tables.notLeP[i][j]) {
        throw new Error(`Contradiction: ${context.languageIds[i]} both compiles and does not compile polynomially to ${context.languageIds[j]}`);
      }
      if ((tables.leQ[i][j] || tables.leP[i][j]) && tables.notLeQ[i][j]) {
        throw new Error(`Contradiction: ${context.languageIds[i]} both compiles and does not compile quasipolynomially to ${context.languageIds[j]}`);
      }
    }
  }

  for (const op of context.operations.allCodes) {
    const supports = tables.supportsP.get(op);
    const notSupports = tables.notSupportsP.get(op);
    if (!supports || !notSupports) continue;
    for (let language = 0; language < n; language += 1) {
      if (supports[language] && notSupports[language]) {
        throw new Error(`Contradiction: ${context.languageIds[language]} both supports and does not support ${op}`);
      }
    }
  }

  for (const op of context.operations.allCodes) {
    if (!isQueryCode(op) && !context.operations.typeByCode.has(op)) {
      throw new Error(`Unknown operation in propagation: ${op}`);
    }
  }
}
