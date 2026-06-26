import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const checkClean = process.argv.includes('--check-clean');

const nodeArgs = [
  '--import',
  pathToFileURL(path.join(rootDir, 'scripts', 'tsx-register.mjs')).href,
  path.join(rootDir, 'scripts', 'latex-bijection.ts')
];

function runLatexBijection(arg) {
  execFileSync(process.execPath, [...nodeArgs, arg], {
    cwd: rootDir,
    stdio: 'inherit'
  });
}

runLatexBijection('--to-latex');
runLatexBijection('--to-json');
runLatexBijection('--to-latex');

if (checkClean) {
  const diff = spawnSync('git', [
    'diff',
    '--',
    'src/lib/data/database.json',
    'docs/definitions.tex',
    'docs/languages.tex',
    'docs/succinctness.tex',
    'docs/queries.tex',
    'docs/transformations.tex',
    'docs/refs.bib'
  ], {
    cwd: rootDir,
    encoding: 'utf8'
  });

  if (diff.status !== 0) {
    process.stdout.write(diff.stdout ?? '');
    process.stderr.write(diff.stderr ?? '');
    process.exit(diff.status ?? 1);
  }

  if (diff.stdout.trim()) {
    console.error('LaTeX round-trip changed canonical files. Run the round-trip locally and commit the generated output.');
    process.stdout.write(diff.stdout);
    process.exit(1);
  }
}

console.log('LaTeX round-trip completed successfully.');
