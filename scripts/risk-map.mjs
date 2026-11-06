// Generates RISK_TEST_COVERAGE.md from the RISK test names (#2233). The map
// used to be edited by hand in most behaviour commits; now the test names are
// the source and this command writes the map.
//
//   node scripts/risk-map.mjs [--root <checkout>] [--check | --write]
//
// --check exits 1 when the committed map differs from the generated one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP = 'RISK_TEST_COVERAGE.md';
const riskTestName = /^\s*test\(\s*(['"])(RISK\b[^'"]*)\1/gm;

const HEADER = `# Risk-based test coverage inventory

This map lists the named RISK contracts in the tests/ area files, grouped by
file in source order, so reviewers can see which costly feature boundaries
already have explicit protection before changing nearby behavior. It is
generated from the test names: run \`npm run risk-map -- --write\` after adding,
renaming or removing a RISK test. A new feature that adds a costly boundary adds
its RISK test; the map follows.
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
  const target = path.join(root, MAP);
  const generated = generateRiskMap(root);
  if (args.includes('--write')) {
    fs.writeFileSync(target, generated);
  } else if (args.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current !== generated) {
      process.stderr.write(`${MAP} is out of date with the RISK tests. Run \`npm run risk-map -- --write\`.\n`);
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(generated);
  }
}
