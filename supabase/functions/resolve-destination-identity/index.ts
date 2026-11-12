import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateAdapter, isGameKey, json } from "../_shared/adapter-auth.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 4096) return json(413, { error: "request_too_large" });

  let body: { game_key?: unknown; crashout_user_id?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const gameKey = body.game_key;
  const crashoutUserId = body.crashout_user_id;
  if (!isGameKey(gameKey) || typeof crashoutUserId !== "string" || !UUID.test(crashoutUserId)) {
    return json(400, { error: "invalid_identity_lookup" });
  }

  if (!await authenticateAdapter(request, gameKey)) {
    return json(401, { error: "adapter_authentication_failed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Destination identity resolver is missing its Supabase server configuration.");
    return json(503, { error: "identity_service_unavailable" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: destination, error: destinationError } = await supabase
    .from("destination_integrations")
    .select("integration_state,enabled")
    .eq("game_key", gameKey)
    .maybeSingle();

  if (destinationError) {
    console.error("Destination identity readiness lookup failed:", destinationError.code ?? "database_error");
    return json(503, { error: "identity_service_unavailable" });
  }
  if (!destination || !destination.enabled || destination.integration_state !== "ready") {
    return json(409, { error: "destination_not_ready" });
  }

  const { data: link, error: linkError } = await supabase
    .from("game_links")
    .select("external_player_id,linked_at")
    .eq("game_key", gameKey)
    .eq("user_id", crashoutUserId)
    .maybeSingle();

  if (linkError) {
    console.error("Destination identity lookup failed:", linkError.code ?? "database_error");
    return json(503, { error: "identity_service_unavailable" });
  }

  return json(200, {
    ok: true,
    game_key: gameKey,
    linked: Boolean(link),
    external_player_id: link?.external_player_id ?? null,
    linked_at: link?.linked_at ?? null,
  });
});
