import assert from "node:assert/strict";
import { hashAccessCode, verifyAccessCode } from "../lib/access-code.ts";
import { getClientProfileById, resolveClientProfileForAccessCode } from "../lib/client-profiles.ts";

process.env.ACCESS_CODE_HASHES = [
  hashAccessCode("ADALO-2026-MATEO"),
  hashAccessCode("ADALO-2026-MOVIMIENTO"),
].join(",");

assert.equal(verifyAccessCode("ADALO-2026-MATEO"), false);
assert.equal(verifyAccessCode("ADALO-2026-MOVIMIENTO"), false);
assert.equal(resolveClientProfileForAccessCode("ADALO-2026-MATEO").id, "general");
assert.equal(resolveClientProfileForAccessCode("ADALO-2026-MOVIMIENTO").id, "general");
assert.equal(getClientProfileById("mateo").id, "mateo");
assert.equal(getClientProfileById("movimiento").id, "movimiento");

console.log("profile-code-not-access-code tests passed");
