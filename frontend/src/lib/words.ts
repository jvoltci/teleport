export function generateCode(): string {
  // Generate a random 6-digit numeric code
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function isValidCode(code: string): boolean {
  // Code must be exactly 6 digits
  return /^\d{6}$/.test(code);
}
