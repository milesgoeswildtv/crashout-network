import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateAdapter, isGameKey, json } from "../_shared/adapter-auth.ts";

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
  if (!isGameKey(gameKey)
      || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)
      || typeof externalPlayerId !== "string" || externalPlayerId.trim().length < 1
      || externalPlayerId.trim().length > 200) {
    return json(400, { error: "invalid_link_request" });
  }

  if (!await authenticateAdapter(request, gameKey)) {
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
