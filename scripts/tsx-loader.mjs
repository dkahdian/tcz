import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'sucrase';

function toCandidateUrls(specifier, parentURL) {
  const parentPath = fileURLToPath(parentURL);
  const parentDir = path.dirname(parentPath);
  const resolvedPath = path.resolve(parentDir, specifier);
  const parsed = path.parse(resolvedPath);
  const candidates = [];

  if (parsed.ext === '.js') {
    candidates.push(resolvedPath.replace(/\.js$/i, '.ts'));
    candidates.push(resolvedPath.replace(/\.js$/i, '.tsx'));
  }

  return candidates.map((candidate) => pathToFileURL(candidate).href);
}

export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    if (!context.parentURL) throw error;
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw error;

    for (const candidate of toCandidateUrls(specifier, context.parentURL)) {
      try {
        return await defaultResolve(candidate, context, defaultResolve);
      } catch {
        // Try the next candidate.
      }
    }

    throw error;
  }
}

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const { code } = transform(source, {
      transforms: ['typescript']
    });
    return {
      format: 'module',
      shortCircuit: true,
      source: code
    };
  }

  if (url.endsWith('.json')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${source.trim()};`
    };
  }

  return defaultLoad(url, context, defaultLoad);
}
