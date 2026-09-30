type IntakeRecord = {
  bytes: Uint8Array;
  name: string;
  type: string;
  expiresAt: number;
};

const STORE_TTL_MS = 10 * 60 * 1000;
const intakeStore = new Map<string, IntakeRecord>();

function cleanupExpired(): void {
  const now = Date.now();
  for (const [token, record] of intakeStore.entries()) {
    if (record.expiresAt <= now) {
      intakeStore.delete(token);
    }
  }
}

function makeToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function saveEstimateIntake(file: { bytes: Uint8Array; name: string; type: string }): string {
  cleanupExpired();
  const token = makeToken();
  intakeStore.set(token, {
    bytes: file.bytes,
    name: file.name || "estimate.pdf",
    type: file.type || "application/pdf",
    expiresAt: Date.now() + STORE_TTL_MS
  });
  return token;
}

export function consumeEstimateIntake(token: string): IntakeRecord | null {
  cleanupExpired();
  const record = intakeStore.get(token);
  if (!record) {
    return null;
  }
  intakeStore.delete(token);
  return record;
}
