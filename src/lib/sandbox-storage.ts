import type { SandboxEdit, SandboxState } from './data/sandbox-transforms.js';

export const SANDBOX_EDITS_STORAGE_KEY = 'kcm_sandbox_edits_v1';

function getStoredValue(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(key);
}

function setStoredValue(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value);
}

function removeStoredValue(key: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key);
}

function isSandboxEdit(value: unknown): value is SandboxEdit {
  if (!value || typeof value !== 'object') return false;
  const edit = value as Record<string, unknown>;
  if (edit.kind === 'edge') {
    return (
      typeof edit.sourceId === 'string' &&
      typeof edit.targetId === 'string' &&
      (typeof edit.status === 'string' || edit.status === null)
    );
  }
  if (edit.kind === 'operation') {
    return (
      (edit.operationType === 'query' || edit.operationType === 'transformation') &&
      typeof edit.languageId === 'string' &&
      typeof edit.operationCode === 'string' &&
      (typeof edit.complexity === 'string' || edit.complexity === null)
    );
  }
  return false;
}

export function loadSandboxState(): SandboxState | null {
  const stored = getStoredValue(SANDBOX_EDITS_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    const edits = Array.isArray(parsed?.edits) ? parsed.edits.filter(isSandboxEdit) : [];
    if (edits.length === 0) return null;
    return {
      edits,
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    };
  } catch (error) {
    console.error('Failed to load sandbox edits:', error);
    return null;
  }
}

export function saveSandboxState(edits: SandboxEdit[]): void {
  if (edits.length === 0) {
    clearSandboxState();
    return;
  }
  try {
    setStoredValue(SANDBOX_EDITS_STORAGE_KEY, JSON.stringify({
      edits,
      updatedAt: new Date().toISOString()
    }));
  } catch (error) {
    console.error('Failed to persist sandbox edits:', error);
  }
}

export function clearSandboxState(): void {
  removeStoredValue(SANDBOX_EDITS_STORAGE_KEY);
}
