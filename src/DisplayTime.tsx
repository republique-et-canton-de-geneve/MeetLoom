import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_ACCOUNT_PREFERENCES,
  type AccountPreferences,
  type AccountProfile,
} from "../shared/accounts";
import { displayTime } from "../shared/display-time";
import { useI18n } from "./i18n";
import { api } from "./api";
const Context = createContext<{
  preferences: AccountPreferences;
  setPreferences: (
    fn: (current: AccountPreferences) => AccountPreferences,
  ) => void;
}>({ preferences: DEFAULT_ACCOUNT_PREFERENCES, setPreferences: () => {} });
export function DisplayTimeProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState<AccountPreferences>({
    ...DEFAULT_ACCOUNT_PREFERENCES,
  });
  useEffect(() => {
    let active = true;
    void api<{ profile: AccountProfile }>("/account")
      .then((result) => {
        if (active) setPreferences(result.profile.preferences);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId]);
  return (
    <Context.Provider value={{ preferences, setPreferences }}>
      {children}
    </Context.Provider>
  );
}
export function DisplayTimeControl({ timezone }: { timezone: string }) {
  const { preferences, setPreferences } = useContext(Context),
    { t } = useI18n();
  return (
    <div className="display-time-control">
      <label>
        {t("Affichage des horaires", "Time display")}
        <select
          aria-label={t(
            "Fuseau d’affichage personnel",
            "Personal display timezone",
          )}
          value={preferences.displayTimezone}
          onChange={(event) =>
            setPreferences((current) => ({
              ...current,
              displayTimezone: event.target.value,
            }))
          }
        >
          <option value="">
            {t("Fuseau de la séance", "Session timezone")} · {timezone}
          </option>
          {Intl.supportedValuesOf("timeZone").map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={preferences.hour12}
          onChange={(event) =>
            setPreferences((current) => ({
              ...current,
              hour12: event.target.checked,
            }))
          }
        />
        {t("12 h", "12 h")}
      </label>
      {((preferences.displayTimezone &&
        preferences.displayTimezone !== timezone) ||
        preferences.hour12) && (
        <small>
          {t(
            "Les champs modifiables restent dans le fuseau de la séance. Votre heure locale s’affiche en dessous.",
            "Editable fields remain in the session timezone. Your local time appears below.",
          )}
        </small>
      )}
    </div>
  );
}
export function LocalClock({
  minute,
  date,
  timezone,
}: {
  minute: number;
  date: string;
  timezone: string;
}) {
  const { preferences } = useContext(Context),
    { locale } = useI18n();
  if (
    (!preferences.displayTimezone ||
      preferences.displayTimezone === timezone) &&
    !preferences.hour12
  )
    return null;
  return (
    <small
      className="local-clock"
      title={preferences.displayTimezone || timezone}
    >
      {displayTime(minute, date, timezone, preferences, locale)}
    </small>
  );
}
