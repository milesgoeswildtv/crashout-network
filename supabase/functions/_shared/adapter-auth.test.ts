import { authenticateAdapter, isGameKey, json } from "./adapter-auth.ts";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("destination adapter authentication is destination-scoped and fail-closed", async () => {
  const envName = "CRASHOUT_SHYST_ADAPTER_KEY_SHA256";
  const previous = Deno.env.get(envName);
  const secret = "test-shyst-adapter-key-that-is-longer-than-thirty-two";
  try {
    assert(isGameKey("shyst"), "known destination key should be accepted");
    assert(isGameKey("realms"), "known destination key should be accepted");
    assert(!isGameKey("unknown"), "unknown destination key must be rejected");
    assert(!isGameKey(null), "non-string destination key must be rejected");

    Deno.env.set(envName, await sha256Hex(secret));
    const validRequest = new Request("https://gateway.invalid", {
      method: "POST",
      headers: { "x-crashout-adapter-key": secret },
    });
    assert(await authenticateAdapter(validRequest, "shyst"), "matching destination secret should authenticate");

    const wrongSecret = new Request("https://gateway.invalid", {
      method: "POST",
      headers: { "x-crashout-adapter-key": "wrong-shyst-adapter-key-that-is-also-long-enough" },
    });
    assert(!await authenticateAdapter(wrongSecret, "shyst"), "wrong secret must be rejected");

    const missingSecret = new Request("https://gateway.invalid", { method: "POST" });
    assert(!await authenticateAdapter(missingSecret, "shyst"), "missing secret must be rejected");

    const shortSecret = new Request("https://gateway.invalid", {
      method: "POST",
      headers: { "x-crashout-adapter-key": "too-short" },
    });
    assert(!await authenticateAdapter(shortSecret, "shyst"), "short secret must be rejected");

    assert(!await authenticateAdapter(validRequest, "poker"), "a SHYST key must not authenticate as Poker");
    Deno.env.set(envName, "not-a-valid-sha256-hash");
    assert(!await authenticateAdapter(validRequest, "shyst"), "malformed configured hash must fail closed");

    const response = json(200, { ok: true });
    assert(response.headers.get("cache-control") === "no-store", "gateway responses must not be cached");
  } finally {
    if (previous === undefined) Deno.env.delete(envName);
    else Deno.env.set(envName, previous);
  }
});
