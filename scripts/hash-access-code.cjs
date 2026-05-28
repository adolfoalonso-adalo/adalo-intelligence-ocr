const { createHash } = require("node:crypto");

const code = process.argv[2];

if (!code) {
  console.error('Uso: corepack pnpm hash:access-code "ADALO-2026-CLIENTE"');
  process.exit(1);
}

const hash = createHash("sha256").update(code.trim()).digest("hex");
console.log(hash);
