const { createHash } = require("node:crypto");

const code = process.argv[2];

if (!code) {
  console.error('Uso: corepack pnpm hash:access-code "ADALO-ADMIN-2026-TEST-8K4P"');
  process.exit(1);
}

const hash = createHash("sha256").update(code.trim()).digest("hex");
console.log(hash);
console.log(`MASTER_ACCESS_CODE_HASH=${hash}`);
