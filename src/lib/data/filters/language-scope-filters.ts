import type {
  GraphData,
  KCLanguage,
  LanguageClassification,
  LanguageFilter,
  LanguageVisibilityParam
} from '../../types.js';
import { mapLanguagesInDataset } from '../transforms.js';
import { LANGUAGE_CLASSIFICATIONS } from '../language-classifications.js';
import { QUERIES, TRANSFORMATIONS } from '../operations.js';
import { getOperationTractabilityDisplay } from '../../utils/operation-tractability.js';

export const DEFAULT_HIDDEN_UNION_LANGUAGE_IDS = Object.entries(LANGUAGE_CLASSIFICATIONS)
  .filter(([, classification]) => classification === 'union')
  .map(([id]) => id);

export const ORIGINAL_KCM_LANGUAGE_IDS = [
  'lang_89649e36', // CNF
  'lang_6c130090', // d-DNNF
  'lang_4c204bf3', // DNF
  'lang_3bebcab7', // DNNF
  'lang_684b1ca7', // FBDD
  'lang_6ae90adc', // IP
  'lang_e02902d0', // MODS
  'lang_5bf00851', // NNF
  'lang_b9d72a7c', // OBDD
  'lang_27fffab2' // PI
];

function getLanguageClassification(language: KCLanguage): LanguageClassification {
  return language.classification ?? 'plain';
}

function shouldKeepForVisibility(language: KCLanguage, visibility: LanguageVisibilityParam): boolean {
  const ids = new Set(visibility.ids);

  switch (visibility.mode) {
    case 'all':
      return true;
    case 'only':
      return ids.has(language.id);
    case 'except':
      return !ids.has(language.id);
    default:
      return true;
  }
}

export const languageVisibilityFilter: LanguageFilter<LanguageVisibilityParam> = {
  id: 'language-visibility',
  name: 'Visibility',
  description: 'Search for languages, queries, and transformations and include or exclude them in bulk',
  applicableViews: ['graph', 'succinctness', 'queries', 'transforms'],
  uiGroup: 'Language Scope',
  kind: 'language-visibility',
  defaultParam: { mode: 'except', ids: DEFAULT_HIDDEN_UNION_LANGUAGE_IDS },
  defaultParamMatrix: { mode: 'except', ids: DEFAULT_HIDDEN_UNION_LANGUAGE_IDS },
  controlType: 'language-picker',
  lambda: (data: GraphData, visibility) => {
    const hiddenQueryIds = new Set(visibility.hiddenQueryIds ?? []);
    const hiddenTransformationIds = new Set(visibility.hiddenTransformationIds ?? []);
    const graphQueryIds = visibility.graphQueryIds ?? [];
    const graphTransformationIds = visibility.graphTransformationIds ?? [];
    const withOperationVisibility = {
      ...data,
      operationVisibility: {
        queryIds: Object.keys(QUERIES).filter((id) => !hiddenQueryIds.has(id)),
        transformationIds: Object.keys(TRANSFORMATIONS).filter((id) => !hiddenTransformationIds.has(id))
      }
    };

    const withGraphOperationLabels = mapLanguagesInDataset(withOperationVisibility, (language) => {
      const suffixParts: string[] = [];

      for (const id of graphQueryIds) {
        const opDef = QUERIES[id];
        if (!opDef) continue;
        const support = language.properties.queries?.[id] ?? language.properties.queries?.[opDef.code];
        if (!support) continue;
        const display = getOperationTractabilityDisplay(support);
        suffixParts.push(`${display.graphSymbol} ${opDef.code}`);
      }

      for (const id of graphTransformationIds) {
        const opDef = TRANSFORMATIONS[id];
        if (!opDef) continue;
        const support =
          language.properties.transformations?.[id] ?? language.properties.transformations?.[opDef.code];
        if (!support) continue;
        const display = getOperationTractabilityDisplay(support);
        suffixParts.push(`${display.graphSymbol} ${opDef.code}`);
      }

      if (suffixParts.length === 0) {
        return language;
      }

      return {
        ...language,
        visual: {
          ...language.visual,
          labelSuffix: `${language.visual?.labelSuffix ?? ''}\n${suffixParts.join('\n')}`
        }
      };
    });

    if (visibility.mode === 'all') {
      return withGraphOperationLabels;
    }

    return mapLanguagesInDataset(withGraphOperationLabels, (language) => {
      return shouldKeepForVisibility(language, visibility) ? language : null;
    });
  }
};

export const languageScopeFilters: LanguageFilter<any>[] = [languageVisibilityFilter];
