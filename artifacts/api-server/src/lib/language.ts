import type { LanguageCode } from "@workspace/api-zod";

export function languageInstruction(language: LanguageCode): string {
  if (language === "am") {
    return "The selected language is Amharic (አማርኛ). Use natural, polished Amharic in the native Ethiopic script. Do not transliterate or switch languages unnecessarily.";
  }
  if (language === "ar") {
    return "The selected language is Arabic (العربية). Use clear, professional Modern Standard Arabic in Arabic script and natural phrasing. Do not transliterate.";
  }
  return "The selected language is English. Use clear, natural English.";
}

export function languageLabel(language: LanguageCode): string {
  if (language === "am") return "Amharic";
  if (language === "ar") return "Arabic";
  return "English";
}
