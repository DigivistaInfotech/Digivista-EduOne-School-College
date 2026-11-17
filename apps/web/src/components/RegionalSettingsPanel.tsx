import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INDIA_STATES, type RegionalSettings } from "@erp/shared/regional";
import { useState } from "react";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import { useLanguage } from "../auth/LanguageContext";
import { getRegionalSettings, saveRegionalSettings } from "../lib/endpoints";
import { errorMessage } from "../lib/api";
import { IndiaFlag } from "./IndiaFlag";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Select,
  TableSkeleton,
} from "./ui";

export function RegionalSettingsPanel() {
  const schoolId = useSchoolId();
  const { t } = useLanguage();
  const query = useQuery({
    queryKey: ["regional-settings", schoolId],
    queryFn: () => getRegionalSettings(schoolId),
  });
  if (query.isPending) return <TableSkeleton rows={2} columns={2} />;
  if (query.isError)
    return (
      <ErrorState
        message={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  return (
    <Card>
      <CardHeader
        title={t("School location & language")}
        description={t(
          "Save a state and the school’s default language. Each user can choose a different interface language.",
        )}
      />
      <RegionalSettingsForm
        key={`${schoolId}:${query.data.version}`}
        settings={query.data.settings}
      />
    </Card>
  );
}

function RegionalSettingsForm({ settings }: { settings: RegionalSettings }) {
  const schoolId = useSchoolId();
  const { can } = useAuth();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const editable = can("school.manage");
  const save = useMutation({
    mutationFn: () => saveRegionalSettings(schoolId, draft),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["regional-settings", schoolId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["school-configs", schoolId],
      });
      setSaved(true);
    },
  });
  return (
    <form
      className="space-y-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="field-label">Country / देश</p>
          <div className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3">
            <IndiaFlag className="h-6 w-9 rounded-sm shadow-sm" />
            <span className="text-sm font-bold">{t("India")}</span>
          </div>
        </div>
        <Field label={t("State")} htmlFor="school-state">
          <Select
            id="school-state"
            value={draft.stateCode ?? ""}
            disabled={!editable || save.isPending}
            onChange={(event) => {
              const state = INDIA_STATES.find(
                (entry) => entry.code === event.target.value,
              );
              setDraft({
                ...draft,
                stateCode: state?.code ?? null,
                defaultLanguage:
                  state?.defaultLanguage ?? draft.defaultLanguage,
              });
              setSaved(false);
            }}
          >
            <option value="">{t("Choose a state")}</option>
            {INDIA_STATES.map((state) => (
              <option key={state.code} value={state.code}>
                {language === "hi" ? state.nameHi : state.name} ({state.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("Default language")} htmlFor="school-language">
          <Select
            id="school-language"
            value={draft.defaultLanguage}
            disabled={!editable || save.isPending}
            onChange={(event) => {
              setDraft({
                ...draft,
                defaultLanguage: event.target.value === "hi" ? "hi" : "en",
              });
              setSaved(false);
            }}
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
          </Select>
        </Field>
      </div>
      <p className="text-xs text-slate-500">
        {t(
          "All Indian states and union territories are available. Selecting a state does not change fee heads, salary rules or past transactions.",
        )}
      </p>
      <p className="text-xs text-slate-500">
        {t(
          "Hindi and English are available for navigation and this school setup. Other screens currently remain in English.",
        )}
      </p>
      {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      {saved && <Alert tone="success">{t("School setup saved.")}</Alert>}
      {editable && (
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>
            {t("Save school setup")}
          </Button>
        </div>
      )}
    </form>
  );
}
