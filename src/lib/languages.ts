/**
 * Static language catalog served by `GET /api/languages`.
 *
 * This mirrors the translation coverage baked into the Trackdub desktop app
 * (Chatterbox multilingual TTS set, 22 languages; Chinese intentionally
 * excluded because it is disabled in the multilingual TTS model). Serving it
 * statically here proves authenticated API routing works end-to-end without a
 * database round-trip. When the backend later reads live model coverage, this
 * list becomes the fallback.
 */
export interface Language {
  code: string;
  name: string;
}

export const LANGUAGES: readonly Language[] = [
  { code: "ar", name: "Arabic" },
  { code: "da", name: "Danish" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ms", name: "Malay" },
  { code: "nl", name: "Dutch" },
  { code: "no", name: "Norwegian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "sv", name: "Swedish" },
  { code: "sw", name: "Swahili" },
  { code: "tr", name: "Turkish" },
] as const;
