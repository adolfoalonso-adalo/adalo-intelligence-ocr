import assert from "node:assert/strict";
import { hashAccessCode, verifyMasterAccessCode } from "../lib/access-code.ts";
import {
  createAccessSessionCookie,
  verifyAccessSessionCookie,
} from "../lib/access-session.ts";
import { getOcrUsageContext } from "../lib/usage.ts";

const masterCode = "ADALO-ADMIN-2026-TEST-8K4P";
process.env.MASTER_ACCESS_CODE_HASH = hashAccessCode(masterCode);

assert.equal(verifyMasterAccessCode(masterCode), true);
assert.equal(verifyMasterAccessCode("ADALO-2026-MOVIMIENTO"), false);

const cookie = createAccessSessionCookie({
  accessMode: "master",
  allowProfileTesting: true,
  clientProfileId: "general",
  isInternalTest: true,
});
const payload = verifyAccessSessionCookie(cookie);

assert.equal(payload?.accessMode, "master");
assert.equal(payload?.clientProfileId, "general");
assert.equal(payload?.allowProfileTesting, true);
assert.equal(payload?.isInternalTest, true);

const usage = await getOcrUsageContext(payload);

assert.equal(usage.allowed, true);
assert.equal(usage.context, null);

console.log("master-access-code tests passed");
