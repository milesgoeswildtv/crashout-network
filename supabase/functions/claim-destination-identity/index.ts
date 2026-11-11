import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { authenticateAdapter, isGameKey, json } from "../_shared/adapter-auth.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function oidcConfig(issuer: string) {
  const url = new URL(".well-known/openid-configuration", issuer.endsWith("/") ? issuer : issuer + "/");
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("oidc_discovery_failed");
  const config = await response.json() as { issuer?: string; jwks_uri?: string };
  if (config.issuer !== issuer || typeof config.jwks_uri !== "string") throw new Error("oidc_issuer_mismatch");
  return config;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > 8192) return json(413, { error: "request_too_large" });

  let body: { game_key?: unknown; external_player_id?: unknown; id_token?: unknown; nonce?: unknown };
  try { body = JSON.parse(raw); } catch { return json(400, { error: "invalid_json" }); }

  const gameKey = body.game_key;
  if (!isGameKey(gameKey)
      || typeof body.external_player_id !== "string"
      || body.external_player_id.trim().length < 1
      || body.external_player_id.length > 200
      || typeof body.id_token !== "string"
      || body.id_token.length > 12_000
      || typeof body.nonce !== "string"
      || body.nonce.length < 16
      || body.nonce.length > 256) {
    return json(400, { error: "invalid_identity_claim" });
  }

  if (!await authenticateAdapter(request, gameKey)) return json(401, { error: "adapter_authentication_failed" });

  const issuer = Deno.env.get("CRASHOUT_OIDC_ISSUER");
  const clientId = Deno.env.get("CRASHOUT_OIDC_CLIENT_ID_" + gameKey.toUpperCase());
  if (!issuer || !clientId) return json(503, { error: "oidc_verification_not_configured" });

  let subject: string;
  try {
    const config = await oidcConfig(issuer);
    const jwks = createRemoteJWKSet(new URL(config.jwks_uri!), { timeoutDuration: 5000 });
    const verified = await jwtVerify(body.id_token, jwks, {
      issuer,
      audience: clientId,
      algorithms: ["RS256", "ES256"],
      clockTolerance: 5,
      maxTokenAge: "10m",
    });
    if (verified.payload.nonce !== body.nonce || typeof verified.payload.sub !== "string" || !UUID.test(verified.payload.sub)) {
      return json(401, { error: "oidc_identity_validation_failed" });
    }
    subject = verified.payload.sub;
  } catch (error) {
    console.warn("OIDC identity claim rejected:", error instanceof Error ? error.message : "verification_error");
    return json(401, { error: "oidc_identity_validation_failed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(503, { error: "identity_service_unavailable" });

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("claim_destination_identity", {
    p_game_key: gameKey,
    p_crashout_user_id: subject,
    p_external_player_id: body.external_player_id.trim(),
  });

  if (error) {
    if (error.code === "23505") return json(409, { error: "identity_already_claimed" });
    if (error.code === "55000") return json(409, { error: "destination_not_ready" });
    console.error("Atomic destination identity claim failed:", error.code ?? "database_error");
    return json(503, { error: "identity_service_unavailable" });
  }

  return json(200, data as Record<string, unknown>);
});
