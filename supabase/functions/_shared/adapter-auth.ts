export const ALLOWED_GAME_KEYS = ["shyst", "poker", "realms", "rituals", "degen", "mmo"] as const;
export type GameKey = typeof ALLOWED_GAME_KEYS[number];

const secretEnv: Record<GameKey, string> = {
  shyst: "CRASHOUT_SHYST_ADAPTER_KEY_SHA256",
  poker: "CRASHOUT_POKER_ADAPTER_KEY_SHA256",
  realms: "CRASHOUT_REALMS_ADAPTER_KEY_SHA256",
  rituals: "CRASHOUT_RITUALS_ADAPTER_KEY_SHA256",
  degen: "CRASHOUT_DEGEN_ADAPTER_KEY_SHA256",
  mmo: "CRASHOUT_MMO_ADAPTER_KEY_SHA256",
};

export function isGameKey(value: unknown): value is GameKey {
  return typeof value === "string" && (ALLOWED_GAME_KEYS as readonly string[]).includes(value);
}

export function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

/** Validate a destination-specific server credential without exposing its value. */
export async function authenticateAdapter(request: Request, gameKey: GameKey): Promise<boolean> {
  const key = request.headers.get("x-crashout-adapter-key") ?? "";
  if (key.length < 32 || key.length > 256) return false;

  const expectedHash = Deno.env.get(secretEnv[gameKey]) ?? "";
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return constantTimeEqual(await sha256Hex(key), expectedHash);
}
