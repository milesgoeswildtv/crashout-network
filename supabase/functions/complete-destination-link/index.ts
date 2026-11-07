import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedKeys = ["shyst", "poker", "realms", "rituals", "degen", "mmo"] as const;
type GameKey = typeof allowedKeys[number];

const secretEnv: Record<GameKey, string> = {
  shyst: "CRASHOUT_SHYST_ADAPTER_KEY_SHA256",
  poker: "CRASHOUT_POKER_ADAPTER_KEY_SHA256",
  realms: "CRASHOUT_REALMS_ADAPTER_KEY_SHA256",
  rituals: "CRASHOUT_RITUALS_ADAPTER_KEY_SHA256",
  degen: "CRASHOUT_DEGEN_ADAPTER_KEY_SHA256",
  mmo: "CRASHOUT_MMO_ADAPTER_KEY_SHA256",
};

function json(status: number, body: Record<string, unknown>) {
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

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 8192) return json(413, { error: "request_too_large" });

  let body: { game_key?: unknown; token?: unknown; external_player_id?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const gameKey = body.game_key;
  const token = body.token;
  const externalPlayerId = body.external_player_id;
  if (typeof gameKey !== "string" || !allowedKeys.includes(gameKey as GameKey)
      || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)
      || typeof externalPlayerId !== "string" || externalPlayerId.trim().length < 1
      || externalPlayerId.trim().length > 200) {
    return json(400, { error: "invalid_link_request" });
  }

  const key = request.headers.get("x-crashout-adapter-key") ?? "";
  if (key.length < 32 || key.length > 256) return json(401, { error: "adapter_authentication_failed" });

  const envName = secretEnv[gameKey as GameKey];
  const expectedHash = Deno.env.get(envName) ?? "";
  if (!/^[a-f0-9]{64}$/.test(expectedHash)
      || !constantTimeEqual(await sha256Hex(key), expectedHash)) {
    return json(401, { error: "adapter_authentication_failed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Destination-link gateway is missing its Supabase server configuration.");
    return json(503, { error: "link_service_unavailable" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("complete_destination_link", {
    p_game_key: gameKey,
    p_token: token,
    p_external_player_id: externalPlayerId.trim(),
  });

  if (error) {
    // Do not log tokens, adapter keys, or external account identifiers.
    console.error("Destination link completion was rejected:", error.code ?? "database_error");
    return json(409, { error: "link_completion_rejected" });
  }

  return json(200, { link_id: data });
});
