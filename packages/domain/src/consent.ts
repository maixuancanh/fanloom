import type { Consent } from "./types.js";

export function canPersonalize(consent: Consent): boolean {
  return consent.status === "active" && consent.purposes.includes("personalization");
}
