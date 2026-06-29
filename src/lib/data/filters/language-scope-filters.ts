import type {
  GraphData,
  KCLanguage,
  LanguageFilter,
  LanguageVisibilityParam
} from '../../types.js';
import { mapLanguagesInDataset } from '../transforms.js';
import { QUERIES, TRANSFORMATIONS } from '../operations.js';
import { getOperationTractabilityDisplay } from '../../utils/operation-tractability.js';
import database from '../database.json';

export const DEFAULT_VISIBLE_LANGUAGE_IDS = [
  'lang_89649e36',
  'lang_6c130090',
  'lang_91f812d0',
  'lang_4c204bf3',
  'lang_3bebcab7',
  'lang_684b1ca7',
  'lang_6ae90adc',
  'lang_e02902d0',
  'lang_1df07cc3',
  'lang_5bf00851',
  'lang_d69995dd',
  'lang_27fffab2',
  'lang_9c84a267',
  'lang_3c803ba1',
  'lang_4e62a038',
  'lang_8cf1da0e',
  'lang_981b62f0',
  'lang_4ae03bc8',
  'lang_82fa749e',
  'lang_e827cf31',
  'lang_43a33aec'
];

const DEFAULT_VISIBLE_LANGUAGE_ID_SET = new Set(DEFAULT_VISIBLE_LANGUAGE_IDS);
const CANONICAL_LANGUAGE_IDS = ((database.languages ?? []) as Array<{ id?: unknown }>)
  .map((language) => language.id)
  .filter((id): id is string => typeof id === 'string');

export const DEFAULT_HIDDEN_LANGUAGE_IDS = CANONICAL_LANGUAGE_IDS.filter(
  (id) => !DEFAULT_VISIBLE_LANGUAGE_ID_SET.has(id)
);

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
  'lang_d69995dd', // OBDD<
  'lang_27fffab2' // PI
];

export const DEFAULT_LANGUAGE_VISIBILITY_PARAM: LanguageVisibilityParam = {
  mode: 'except',
  ids: DEFAULT_HIDDEN_LANGUAGE_IDS
};

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
  defaultParam: DEFAULT_LANGUAGE_VISIBILITY_PARAM,
  defaultParamMatrix: DEFAULT_LANGUAGE_VISIBILITY_PARAM,
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
