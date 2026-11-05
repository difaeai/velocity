/** Pakistani mobile numbers as a driver types them, for the WhatsApp number fields. */

/** "+92 300 1234567" / "0300-1234567" → "3001234567" (the subscriber digits). */
export function stripPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('92') && d.length > 10) d = d.slice(2);
  d = d.replace(/^0+/, '');
  return d;
}

/** "3001234567" → "300 1234567" (display only). */
export function prettyPhone(digits: string): string {
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/** Every Pakistani mobile is ten digits starting with 3, once 0/+92 is gone. */
export function isValidPkMobile(digits: string): boolean {
  return /^3\d{9}$/.test(digits);
}

/** `923001234567` (as stored) → the subscriber digits the input shows. */
export function subscriberDigits(stored: string | undefined): string {
  if (!stored) return '';
  return stored.startsWith('92') ? stored.slice(2) : stored;
}
