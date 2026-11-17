import { useQuery } from "@tanstack/react-query";
import { DEFAULT_REGIONAL_SETTINGS, type AppLanguage } from "@erp/shared/regional";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import { getRegionalSettings } from "../lib/endpoints";
import { translate } from "../lib/translations";

type LanguageChoice = AppLanguage | "school";
const LanguageContext = createContext<{
  language: AppLanguage;
  choice: LanguageChoice;
  setChoice: (choice: LanguageChoice) => void;
  t: (text: string) => string;
} | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, membership } = useAuth();
  const schoolId = membership?.schoolId;
  const regional = useQuery({
    queryKey: ["regional-settings", schoolId],
    queryFn: () => getRegionalSettings(schoolId!),
    enabled: !!schoolId,
  });
  const [choices, setChoices] = useState<Record<string, LanguageChoice>>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem("erp.languagePreferences") ?? "{}",
      );
      if (!saved || typeof saved !== "object" || Array.isArray(saved))
        return {};
      return Object.fromEntries(
        Object.entries(saved).filter(
          ([, value]) => value === "en" || value === "hi",
        ),
      );
    } catch {
      return {};
    }
  });
  const preferenceKey =
    user && schoolId ? `${user.id}:${schoolId}` : "anonymous";
  const choice = choices[preferenceKey] ?? "school";
  const language =
    choice === "school"
      ? (regional.data?.settings.defaultLanguage ??
        DEFAULT_REGIONAL_SETTINGS.defaultLanguage)
      : choice;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  function setChoice(next: LanguageChoice) {
    setChoices((current) => {
      const updated = { ...current };
      if (next === "school") delete updated[preferenceKey];
      else updated[preferenceKey] = next;
      try {
        localStorage.setItem(
          "erp.languagePreferences",
          JSON.stringify(updated),
        );
      } catch {
        /* In-memory preference still works. */
      }
      return updated;
    });
  }

  return (
    <LanguageContext.Provider
      value={{
        language,
        choice,
        setChoice,
        t: (text) => translate(language, text),
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("LanguageProvider is missing");
  return value;
}
