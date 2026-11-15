// FUTURE (super admin setting): which languages exist is fixed here; see docs/FUTURE_SETTINGS.md.
export const PUSH_LANGUAGES = [
  { code: "en", label: "English" }, { code: "si", label: "සිංහල" },
  { code: "ta", label: "தமிழ்" }, { code: "si-Latn", label: "Singlish" },
];
export const PUSH_LANGUAGE_CODES = PUSH_LANGUAGES.map((language) => language.code);
