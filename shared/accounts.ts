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
    /** Emails about problem reports and ideas: each new one for
     * administrators, and the progress of one's own. Saved on its own
     * (PUT /api/account/email-feedback) and never sent with the profile, so
     * a server from before this option still accepts profile saves during a
     * rolling update; missing means on. */
    emailFeedback: z.boolean().optional(),
  })
  .strict();
export type AccountPreferences = z.infer<typeof accountPreferencesSchema>;
export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  displayTimezone: "",
  hour12: false,
  inAppMentions: true,
  emailDigest: false,
  emailReminder: false,
  emailFeedback: true,
};
export interface AccountProfile {
  avatar?: string;
  preferences: AccountPreferences;
}
