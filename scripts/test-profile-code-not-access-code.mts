import assert from "node:assert/strict";
import { hashAccessCode, verifyAccessCode } from "../lib/access-code.ts";
import { getClientProfileById, resolveClientProfileForAccessCode } from "../lib/client-profiles.ts";

process.env.ACCESS_CODE_HASHES = [
  hashAccessCode("ADALO-2026-MATEO"),
  hashAccessCode("ADALO-2026-MOVIMIENTO"),
].join(",");

assert.equal(verifyAccessCode("ADALO-2026-MATEO"), true);
assert.equal(verifyAccessCode("ADALO-2026-MOVIMIENTO"), true);
assert.equal(resolveClientProfileForAccessCode("ADALO-2026-MATEO").id, "internal-general");
assert.equal(resolveClientProfileForAccessCode("ADALO-2026-MOVIMIENTO").id, "internal-general");
assert.equal(getClientProfileById("mateo").id, "internal-dtve-senasa-arca");
assert.equal(getClientProfileById("movimiento").id, "internal-movimiento-camiones");

console.log("access-code/internal-profile separation tests passed");
