const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const apiDir = path.join(__dirname, '..', 'apps', 'api');
const distDir = path.join(apiDir, 'dist');
const scriptsSourceDir = path.join(apiDir, 'src', 'scripts');
const runtimeSources = [
  {
    source: path.join(apiDir, 'src', 'env-loader.ts'),
    output: path.join(distDir, 'env-loader.js'),
  },
  ...fs
    .readdirSync(scriptsSourceDir)
    .filter(name => name.endsWith('.ts'))
    .map(name => ({
      source: path.join(scriptsSourceDir, name),
      output: path.join(distDir, 'scripts', name.replace(/\.ts$/, '.js')),
    })),
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
