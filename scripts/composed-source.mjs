import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import ts from 'typescript';
// Positive source guards follow the real composition imports after a refactor.
// Negative transport guards continue to inspect the transport file alone.
export function readComposedSource(file,seen=new Set()){
const absolute=resolve(file);if(seen.has(absolute))return '';seen.add(absolute);
const text=readFileSync(absolute,'utf8').replace(/\r\n?/g,'\n'),sf=ts.createSourceFile(file,text,99,true);let result=text;
for(const node of sf.statements){if(!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node))continue;const name=node.moduleSpecifier?.text;if(!name||!(name.startsWith('./')||name.startsWith('../')||name.startsWith('@/lib/application/')))continue;const target=name.startsWith('@/')?resolve('src',name.slice(2)):resolve(dirname(absolute),name);const resolved=[target+'.ts',target+'.tsx',target+'/index.ts'].find(existsSync);if(resolved&&relative(resolve('src'),resolved).split(/[\\/]/)[0]!=='..')result+='\n'+readComposedSource(resolved,seen)}return result;
}
