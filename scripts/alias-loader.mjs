import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("@/")) {
    const withoutAlias = specifier.slice(2);
    const candidates = [
      resolvePath(process.cwd(), withoutAlias),
      resolvePath(process.cwd(), `${withoutAlias}.ts`),
      resolvePath(process.cwd(), `${withoutAlias}.tsx`),
      resolvePath(process.cwd(), `${withoutAlias}.js`),
    ];
    const match = candidates.find((candidate) => existsSync(candidate));

    if (match) {
      return {
        shortCircuit: true,
        url: pathToFileURL(match).href,
      };
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}
