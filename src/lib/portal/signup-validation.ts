export type SignupInput = { email: string; password: string };

// Returns a user-facing error string, or null when valid.
export function validateSignupInput(body: unknown): string | null {
  if (!body || typeof body !== "object") return "Missing signup details.";
  const { email, password } = body as Partial<SignupInput>;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  if (typeof password !== "string" || password.length < 8) return "Password must be at least 8 characters.";
  return null;
}
