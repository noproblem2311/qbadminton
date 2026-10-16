const STORAGE_KEY = 'qbadminton.apiKey';

// Browser storage can be unavailable (private mode, blocked site data); never let it break the page.

export function loadApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveApiKey(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Kept in memory for this visit only.
  }
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}
