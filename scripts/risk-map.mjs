// Prints the RISK coverage map from the RISK test names (#2233). The map used
// to be edited by hand in most behaviour commits, then generated and committed
// with a check that the copy matched. The committed copy was still touched in
// 263 of 653 commits and marked each one a process change, so the map now
// prints on demand and nothing commits it (#2381).
//
//   node scripts/risk-map.mjs [--root <checkout>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const riskTestName = /^\s*test\(\s*(['"])(RISK\b[^'"]*)\1/gm;

const HEADER = `# Risk-based test coverage inventory

This map lists the named RISK contracts in the tests/ area files, grouped by
file in source order, so reviewers can see which costly feature boundaries
already have explicit protection before changing nearby behavior. It is
printed on demand from the test names by \`npm run risk-map\` and is not
committed. A new feature that adds a costly boundary adds its RISK test; the
map follows.
`;

export function generateRiskMap(root) {
  const dir = path.join(root, 'tests');
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.test.js')).sort();
  const sections = files.flatMap(name => {
    const names = [...fs.readFileSync(path.join(dir, name), 'utf8').matchAll(riskTestName)].map(match => match[2]);
    return names.length ? [`## tests/${name}\n\n${names.map(entry => `- ${entry}`).join('\n')}\n`] : [];
  });
  return [HEADER, ...sections].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] ?? '' : process.cwd());
  process.stdout.write(generateRiskMap(root));
}
