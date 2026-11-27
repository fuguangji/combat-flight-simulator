import { readFile, readdir, writeFile, mkdir, access, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = resolve(root, 'src/aircraft/data');
const visualDir = resolve(root, 'src/aircraft/visuals');
const sourcePath = resolve(root, 'src/aircraft/builder/modularAircraft.ts');
const temporaryModule = resolve(root, '.aircraft-visual-generator.mjs');

await mkdir(visualDir, { recursive: true });
const source = await readFile(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;

try {
  await writeFile(temporaryModule, compiled, 'utf8');
  const builder = await import(pathToFileURL(temporaryModule).href);
  const files = (await readdir(dataDir)).filter((file) => file.endsWith('.json')).sort();
  let created = 0;
  let preserved = 0;

  for (const file of files) {
    const aircraft = JSON.parse(await readFile(resolve(dataDir, file), 'utf8'));
    const key = aircraft.key;
    if (typeof key !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)) {
      throw new Error(`Invalid aircraft key in ${file}`);
    }
    const destination = resolve(visualDir, `${key}.json`);
    try {
      await access(destination);
      preserved++;
      continue; // Hand-authored editor exports always win over generated defaults.
    } catch {
      // No asset yet: generate a V2 editor-compatible default.
    }

    const config = builder.normalizeAircraftVisualConfig(
      builder.createProceduralAircraftConfig(aircraft.id),
    );
    config.name = aircraft.displayName ?? key;
    config.aircraftKey = key;

    const bind = (id, animation) => {
      const component = config.components.find((item) => item.id === `component-${id}`);
      if (component) component.animation = animation;
    };
    bind('cockpit-control-stick', { channel: 'pitch', axis: 'z', min: -0.16, max: 0.16 });
    bind('canopy', { channel: 'canopy', axis: 'z', min: 0, max: 0.62 });
    bind('cockpit-gear-lever', { channel: 'gear', axis: 'z', min: 0, max: -0.42 });

    const validated = builder.normalizeAircraftVisualConfig(config);
    await writeFile(destination, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    created++;
  }

  process.stdout.write(`Aircraft visual assets: ${created} V2 generated, ${preserved} existing assets preserved.\n`);
} finally {
  await unlink(temporaryModule).catch(() => undefined);
}
