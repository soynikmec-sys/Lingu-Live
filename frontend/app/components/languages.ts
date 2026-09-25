// Lista única de idiomas (nombres en español) para los pickers de
// "hablás" (usa speechTag BCP-47 para Web Speech) y "ves" (usa code
// corto para Gemini). ES y EN van fijos primero en la UI.

export interface LangOption {
  // Código corto para traducción (Gemini / translationConfig)
  code: string;
  // Tag completo para reconocimiento de voz (Web Speech API)
  speechTag: string;
  // Nombre en español
  label: string;
}

export const PINNED_LANGS: LangOption[] = [
  { code: 'es', speechTag: 'es-ES', label: 'Español' },
  { code: 'en', speechTag: 'en-US', label: 'Inglés' },
];

export const ALL_LANGS: LangOption[] = [
  ...PINNED_LANGS,
  { code: 'pt', speechTag: 'pt-BR', label: 'Portugués' },
  { code: 'fr', speechTag: 'fr-FR', label: 'Francés' },
  { code: 'de', speechTag: 'de-DE', label: 'Alemán' },
  { code: 'it', speechTag: 'it-IT', label: 'Italiano' },
  { code: 'zh', speechTag: 'zh-CN', label: 'Chino' },
  { code: 'ja', speechTag: 'ja-JP', label: 'Japonés' },
  { code: 'ko', speechTag: 'ko-KR', label: 'Coreano' },
  { code: 'ar', speechTag: 'ar-SA', label: 'Árabe' },
  { code: 'hi', speechTag: 'hi-IN', label: 'Hindi' },
  { code: 'ru', speechTag: 'ru-RU', label: 'Ruso' },
  { code: 'nl', speechTag: 'nl-NL', label: 'Neerlandés' },
  { code: 'pl', speechTag: 'pl-PL', label: 'Polaco' },
  { code: 'tr', speechTag: 'tr-TR', label: 'Turco' },
  { code: 'uk', speechTag: 'uk-UA', label: 'Ucraniano' },
  { code: 'ro', speechTag: 'ro-RO', label: 'Rumano' },
  { code: 'el', speechTag: 'el-GR', label: 'Griego' },
  { code: 'sv', speechTag: 'sv-SE', label: 'Sueco' },
  { code: 'no', speechTag: 'nb-NO', label: 'Noruego' },
  { code: 'da', speechTag: 'da-DK', label: 'Danés' },
  { code: 'fi', speechTag: 'fi-FI', label: 'Finlandés' },
  { code: 'cs', speechTag: 'cs-CZ', label: 'Checo' },
  { code: 'hu', speechTag: 'hu-HU', label: 'Húngaro' },
  { code: 'he', speechTag: 'he-IL', label: 'Hebreo' },
  { code: 'th', speechTag: 'th-TH', label: 'Tailandés' },
  { code: 'vi', speechTag: 'vi-VN', label: 'Vietnamita' },
  { code: 'id', speechTag: 'id-ID', label: 'Indonesio' },
  { code: 'ms', speechTag: 'ms-MY', label: 'Malayo' },
  { code: 'ca', speechTag: 'ca-ES', label: 'Catalán' },
  { code: 'eu', speechTag: 'eu-ES', label: 'Vasco' },
  { code: 'gl', speechTag: 'gl-ES', label: 'Gallego' },
];

// Etiqueta corta (2 letras) para mostrar en la pill
export const shortLabel = (opt: LangOption) => opt.code.toUpperCase();

export const findBySpeechTag = (tag: string): LangOption =>
  ALL_LANGS.find((l) => l.speechTag === tag) ?? PINNED_LANGS[0];

export const findByCode = (code: string): LangOption =>
  ALL_LANGS.find((l) => l.code === code) ?? PINNED_LANGS[0];
