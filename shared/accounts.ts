import { z } from "zod";
export const accountPreferencesSchema = z
  .object({
    displayTimezone: z
      .string()
      .max(100)
      .default("")
      .refine((value) => {
        if (!value) return true;
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
    hour12: z.boolean().default(false),
    inAppMentions: z.boolean().default(true),
    emailDigest: z.boolean().default(false),
    emailReminder: z.boolean().default(false),
  })
  .strict();
export type AccountPreferences = z.infer<typeof accountPreferencesSchema>;
export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  displayTimezone: "",
  hour12: false,
  inAppMentions: true,
  emailDigest: false,
  emailReminder: false,
};
export interface AccountProfile {
  avatar?: string;
  preferences: AccountPreferences;
}
