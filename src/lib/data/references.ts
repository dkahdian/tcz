import type { KCReference } from '../types.js';
import { extractCitationKey } from '../utils/reference-id.js';
import { extractBibtexField, cleanBibtexText } from '../utils/bibtex.js';
import database from './database.json';

/**
 * Parse BibTeX entry to extract metadata and format as IEEE citation
 */
export function parseBibtex(bibtex: string): { id: string; title: string; href: string } {
  const url = extractBibtexField(bibtex, 'url');
  const doi = extractBibtexField(bibtex, 'DOI');
  const titleRaw = extractBibtexField(bibtex, 'title');
  const authorRaw = extractBibtexField(bibtex, 'author');
  const year = extractBibtexField(bibtex, 'year');
  const journal = extractBibtexField(bibtex, 'journal');
  const booktitle = extractBibtexField(bibtex, 'booktitle');
  const volume = extractBibtexField(bibtex, 'volume');
  const pages = extractBibtexField(bibtex, 'pages');
  
  const id = extractCitationKey(bibtex) || 'unknown';
  
  let href = '#';
  if (url) {
    href = url;
  } else if (doi) {
    href = `https://doi.org/${doi}`;
  }
  
  let title = 'Unknown Reference';
  
  if (authorRaw && titleRaw && year) {
    const authorList = authorRaw.split(/\s+and\s+/i);
    
    const formattedAuthors = authorList.map(author => {
      const cleaned = cleanBibtexText(author);
      const parts = cleaned.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        const lastName = parts[0];
        const firstNames = parts[1].split(/\s+/);
        const initials = firstNames
          .filter(name => name.length > 0)
          .map(name => name.charAt(0).toUpperCase() + '.')
          .join(' ');
        return `${initials} ${lastName}`;
      }
      return cleaned;
    });
    
    let authorsStr = '';
    if (formattedAuthors.length === 1) {
      authorsStr = formattedAuthors[0];
    } else if (formattedAuthors.length === 2) {
      authorsStr = `${formattedAuthors[0]} and ${formattedAuthors[1]}`;
    } else {
      authorsStr = formattedAuthors.slice(0, -1).join(', ') + ', and ' + formattedAuthors[formattedAuthors.length - 1];
    }
    
    const titleText = cleanBibtexText(titleRaw);
    
    title = `${authorsStr}, "${titleText},"`;
    
    // Use journal or booktitle (for conference papers)
    const venue = journal || booktitle;
    if (venue) {
      title += ` ${cleanBibtexText(venue)},`;
    }
    
    if (volume) {
      title += ` vol. ${volume},`;
    }
    
    if (pages) {
      title += ` pp. ${cleanBibtexText(pages)},`;
    }
    
    title += ` ${year}.`;
  } else if (titleRaw) {
    title = cleanBibtexText(titleRaw);
  }
  
  return { id, title, href };
}

/**
 * Database reference entry type - may have pre-parsed title and href or just bibtex.
 * If title/href are missing, they will be parsed from bibtex at runtime.
 */
interface DatabaseReference {
  id: string;
  bibtex: string;
  /** Pre-parsed/verified display title in IEEE format (optional - parsed from bibtex if missing) */
  title?: string;
  /** Pre-parsed/verified URL for the reference (optional - parsed from bibtex if missing) */
  href?: string;
}

// Build reference map from JSON data
const referencesMap: Record<string, KCReference> = {};

const referencesData = database.references as DatabaseReference[];

for (const ref of referencesData) {
  const parsed = parseBibtex(ref.bibtex);
  referencesMap[ref.id] = {
    id: ref.id,
    title: parsed.title !== 'Unknown Reference' ? parsed.title : (ref.title ?? parsed.title),
    href: parsed.href !== '#' ? parsed.href : (ref.href ?? parsed.href),
    bibtex: ref.bibtex
  };
}

export function getReferences(...ids: string[]): KCReference[] {
  return ids.map(id => referencesMap[id]).filter(Boolean);
}

export const allReferences = Object.values(referencesMap);

// Build a map from reference ID to its global index (1-based for display)
const globalRefIndexMap = new Map<string, number>();
allReferences.forEach((ref, idx) => {
  globalRefIndexMap.set(ref.id, idx + 1);
  // Also map lowercase version for case-insensitive lookup
  globalRefIndexMap.set(ref.id.toLowerCase(), idx + 1);
});

/**
 * Get the global reference number (1-based) for a reference ID.
 * Returns null if the reference is not found.
 */
export function getGlobalRefNumber(id: string): number | null {
  return globalRefIndexMap.get(id) ?? globalRefIndexMap.get(id.toLowerCase()) ?? null;
}
