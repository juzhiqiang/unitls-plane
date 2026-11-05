const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const apiDir = path.join(__dirname, '..', 'apps', 'api');
const distDir = path.join(apiDir, 'dist');
const runtimeSources = [
  {
    source: path.join(apiDir, 'src', 'env-loader.ts'),
    output: path.join(distDir, 'env-loader.js'),
  },
  {
    source: path.join(apiDir, 'src', 'scripts', 'migrate.ts'),
    output: path.join(distDir, 'scripts', 'migrate.js'),
  },
  {
    source: path.join(apiDir, 'src', 'scripts', 'sync-id-photo-models.ts'),
    output: path.join(distDir, 'scripts', 'sync-id-photo-models.js'),
  },
  {
    source: path.join(
      apiDir,
      'src',
      'scripts',
      'seed-image-generate-presets.ts'
    ),
    output: path.join(distDir, 'scripts', 'seed-image-generate-presets.js'),
  },
];

const compilerOptions = {
  esModuleInterop: true,
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
};

for (const { source, output } of runtimeSources) {
  const sourceText = fs.readFileSync(source, 'utf8');
  const { outputText, diagnostics } = ts.transpileModule(sourceText, {
    compilerOptions,
    fileName: source,
  });

  if (diagnostics.length > 0) {
    throw new Error(
      `Failed to transpile ${path.relative(process.cwd(), source)}: ${ts.formatDiagnostics(diagnostics, undefined)}`
    );
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, outputText);
  console.log(`Compiled ${path.relative(process.cwd(), source)}`);
}
