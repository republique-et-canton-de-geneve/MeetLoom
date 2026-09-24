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

/** Requests per minute. Browsers poll every three seconds (about 20 per
 * minute per open page), so these leave room for many tabs and for a room of
 * visitors sharing one public address, while still stopping a flood. */
export interface RequestBudget {
  /** Every request from one client address (IPv6 grouped by subnet). */
  perAddress: number;
  /** Every request of one signed-in account, whatever its address. */
  perUser: number;
}
export const DEFAULT_REQUEST_BUDGET: RequestBudget = {
  perAddress: 12000,
  perUser: 1200,
};
export const requestBudget = (
  overrides: Partial<RequestBudget> = {},
): RequestBudget => ({ ...DEFAULT_REQUEST_BUDGET, ...overrides });
