/** Caps on what anonymous holders of a public link can store. Per-IP rate
 * limits slow one client down; these bound the total, so a leaked or widely
 * shared link cannot fill the database that every session shares. */
export interface PublicQuotas {
  /** Responses kept per published form. */
  formResponses: number;
  /** Characters of answers and images kept per published form. */
  formBytes: number;
  /** Visitor comments kept per share link. */
  visitorComments: number;
}
export const DEFAULT_PUBLIC_QUOTAS: PublicQuotas = {
  formResponses: 5000,
  formBytes: 100 * 1024 * 1024,
  visitorComments: 2000,
};
export const publicQuotas = (
  overrides: Partial<PublicQuotas> = {},
): PublicQuotas => ({ ...DEFAULT_PUBLIC_QUOTAS, ...overrides });
