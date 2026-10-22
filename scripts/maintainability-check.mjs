import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=file=>readFileSync(file,'utf8');
for(const file of ['src/components/DentalSuite.tsx','src/modules/billing/BillingPanel.tsx','src/modules/journey/PatientJourneyPanel.tsx','src/modules/settings/SettingsPanel.tsx'])assert.ok(source(file).split('\n').length<=20,`${file}: compose the model and view instead of growing a controller`);
for(const file of ['src/components/suite-model.tsx','src/modules/billing/billing-model.tsx','src/modules/journey/journey-model.tsx','src/modules/settings/settings-model.tsx']){assert.ok(source(file).split('\n').length<=800,`${file}: extract the next responsibility`);assert.doesNotMatch(source(file),/=>\s*\{\s*\}/,`${file}: empty workflow callback`)}
const canonical=new Map(['patientCodeFor','patientClassCodeFor','stableNumberFromText','serviceProgressPercent','serviceProgressIsCancelled','serviceProgressLabelFromPercent','normalizeSearchText'].map(name=>[name,[]]));
function walk(dir){for(const name of readdirSync(dir)){const file=join(dir,name);if(statSync(file).isDirectory()){walk(file);continue}if(!/\.tsx?$/.test(file))continue;const text=source(file),sf=ts.createSourceFile(file,text,99,true,name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);function inspect(node){if(ts.isFunctionDeclaration(node)&&canonical.has(node.name?.text))canonical.get(node.name.text).push(file);ts.forEachChild(node,inspect)}inspect(sf);if(/src[\\/]lib[\\/]application[\\/](settings|staff|inventory)[\\/]/.test(file)){assert.ok(text.split('\n').length<=700,`${file}: application responsibility budget`);assert.doesNotMatch(text,/\bFormData\b|from ["']next\//,`${file}: transport leaked into a business command`)}}}
walk('src');for(const [name,files]of canonical)assert.equal(files.length,1,`${name}: canonical helper duplicated at ${files.join(', ')}`);
assert.equal(JSON.parse(source('tsconfig.json')).compilerOptions.noUnusedLocals,true);assert.equal(JSON.parse(source('tsconfig.json')).compilerOptions.noUnusedParameters,true);
console.log('Maintainability budgets passed: bounded composers/models/commands, unique shared helpers, no empty workflow callbacks, unused-code compiler gates.');
