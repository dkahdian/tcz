/**
 * Generate a deterministic hash-based ID from a language name.
 * Uses a simple FNV-1a hash to create an 8-character alphanumeric ID.
 * This ensures IDs are URL-safe, Cytoscape-safe, and collision-resistant.
 * 
 * Examples:
 * - "OBDD$_<$" -> "lang_a4f8c3d2"
 * - "NNF" -> "lang_b7e9d1a5"
 */
export function generateLanguageId(name: string): string {
  // FNV-1a hash (32-bit)
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Convert to unsigned 32-bit and then to hex
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `lang_${hex}`;
}

/**
 * Module-level name map for resolving language IDs to display names.
 * Must be initialized via initNameMap() before use.
 */
let _nameMap: Map<string, string> = new Map();
let _nameToIdMap: Map<string, string> = new Map();
let _normalizedNameToIdMap: Map<string, string> = new Map();

function decodeMinimalEntities(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function normalizeLanguageNameKey(value: string): string {
  let normalized = decodeMinimalEntities(value)
    .trim()
    .replace(/^\\langfam\{([^{}]+)\}\{([^{}]+)\}(?:\{[^{}]*\})?$/i, '$1_$2')
    .replace(/^\\langref\{((?:[^{}]|\{[^{}]*\})+)\}(?:\{[^{}]*\})?$/i, '$1')
    .replace(/\\textless\{\}/gi, '<')
    .replace(/\\textless(?![A-Za-z])/gi, '<')
    .replace(/\$<\$/g, '<')
    .replace(/\$/g, '')
    .replace(/\\_/g, '_')
    .replace(/_\{\s*([^{}]+)\s*\}/g, '_$1')
    .replace(/([A-Za-z0-9-])_<(?![A-Za-z0-9])/g, '$1$_<$')
    .replace(/([A-Za-z0-9-])_([A-Za-z0-9]+)(?![A-Za-z0-9])/g, '$1$_$2$')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  // Canonicalize accidental mixed forms like OBDD$_<{ }$ -> OBDD$_<$
  normalized = normalized
    .replace(/\$_\{\s*</g, '$_<')
    .replace(/\$_\{\s*([a-z0-9]+)\s*\}\$/g, '$_$1$');

  return normalized;
}

/**
 * Initialize the name map from a list of languages.
 * Call this once when loading data.
 */
export function initNameMap(languages: Array<{ id?: string; name: string }>): void {
  _nameMap = new Map();
  _nameToIdMap = new Map();
  _normalizedNameToIdMap = new Map();
  for (const lang of languages) {
    if (lang.id) {
      _nameMap.set(lang.id, lang.name);
      _nameToIdMap.set(lang.name, lang.id);
      _normalizedNameToIdMap.set(normalizeLanguageNameKey(lang.name), lang.id);
    }
  }
}

/**
 * Resolve a language ID to its display name.
 * Falls back to the ID itself if not found.
 */
export function idToName(id: string): string {
  return _nameMap.get(id) ?? id;
}

/**
 * Resolve a language display name to its ID.
 * Returns undefined if not found.
 */
export function nameToId(name: string): string | undefined {
  const exact = _nameToIdMap.get(name);
  if (exact) return exact;
  return _normalizedNameToIdMap.get(normalizeLanguageNameKey(name));
}
