import type { GraphData, LanguageFilter } from '../../types.js';
import { mapLanguagesInDataset } from '../transforms.js';

// Snapshot of the previous default view: all languages except the old
// classification=union languages. This preserves default visibility without
// keeping classification in the data model.
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

export const defaultLanguageVisibilityFilter: LanguageFilter<boolean> = {
  id: 'default-language-visibility',
  name: 'Default language visibility',
  description: 'Preserves the canonical default language set.',
  applicableViews: ['graph', 'succinctness', 'queries', 'transforms'],
  uiGroup: 'Language Scope',
  kind: 'internal',
  hidden: true,
  defaultParam: true,
  controlType: 'checkbox',
  lambda: (data: GraphData, enabled) => {
    if (!enabled) return data;
    return mapLanguagesInDataset(data, (language) =>
      DEFAULT_VISIBLE_LANGUAGE_ID_SET.has(language.id) ? language : null
    );
  }
};
