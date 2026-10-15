/**
 * The shape `shared/api.ts` names for an organisation's branding. The desktop app has no
 * organisations, so nothing ever fills one; the type stays so the contract compiles.
 */
export interface Branding {
  name: string | null;
  word: string | null;
  accent: string | null;
  logoUrl: string | null;
}
