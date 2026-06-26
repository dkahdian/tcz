import type { KCLanguage } from '../types.js';
import database from './database.json';

const rawLanguages = database.languages as any[];

function enrichLanguage(langJson: any): KCLanguage {
  return { ...langJson } as KCLanguage;
}

export const allLanguages: KCLanguage[] = rawLanguages.map(enrichLanguage);
