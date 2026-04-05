import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ExploreState {
  // Filters (persisted)
  languages: string[];
  region: string;
  selectedCategory: string;

  // Search (not persisted)
  searchQuery: string;

  // Actions
  setLanguages: (languages: string[]) => void;
  setRegion: (region: string) => void;
  setSelectedCategory: (category: string) => void;
  setSearchQuery: (query: string) => void;
  resetFilters: () => void;
}

// Catalog DB stores ISO 639-1 (2-letter) codes: en, hi, ta, fr, etc.
// Browser navigator.language also uses 2-letter BCP 47 primary subtags.
const SUPPORTED_LANGUAGES = new Set([
  'en',
  'hi',
  'ta',
  'te',
  'bn',
  'mr',
  'gu',
  'kn',
  'ml',
  'pa',
  'ur',
  'sa',
  'fr',
  'de',
  'es',
  'pt',
  'zh',
  'ja',
  'ko',
]);

function detectDefaultLanguages(): string[] {
  if (typeof navigator === 'undefined') return ['en'];
  const primary = navigator.language.split('-')[0]!.toLowerCase();
  const lang = SUPPORTED_LANGUAGES.has(primary) ? primary : 'en';
  return lang === 'en' ? ['en'] : ['en', lang];
}

function detectDefaultRegion(): string {
  if (typeof navigator === 'undefined') return '';
  // Use timezone heuristic for region detection
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (
      tz.startsWith('Asia/Kolkata') ||
      tz.startsWith('Asia/Calcutta') ||
      tz.startsWith('Asia/Colombo')
    )
      return 'IN';
    if (tz.startsWith('America/')) return 'US';
  } catch {
    // Ignore — return empty (no region filter)
  }
  return '';
}

export const useExploreStore = create<ExploreState>()(
  persist(
    (set) => ({
      languages: detectDefaultLanguages(),
      region: detectDefaultRegion(),
      selectedCategory: '',
      searchQuery: '',

      setLanguages: (languages) => set({ languages }),
      setRegion: (region) => set({ region }),
      setSelectedCategory: (category) => set({ selectedCategory: category }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      resetFilters: () =>
        set({
          languages: detectDefaultLanguages(),
          region: detectDefaultRegion(),
          selectedCategory: '',
          searchQuery: '',
        }),
    }),
    {
      name: 'explore-storage',
      partialize: (state) => ({
        languages: state.languages,
        region: state.region,
        // selectedCategory intentionally NOT persisted — should reset to browse mode on page load
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<ExploreState>),
      }),
    },
  ),
);
