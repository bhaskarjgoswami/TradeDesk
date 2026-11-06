import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {auditTranslations} from '../../scripts/audit-translations.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
for(const code of ['hi','es','fr','de','pt','ar','zh-CN'])test('visible interface copy has translation entries for '+code,()=>{
 const result=auditTranslations(root,code);assert.ok(result.total>1000);assert.deepEqual(result.missing,[],result.missing.map(row=>row.text+' ('+row.files.join(', ')+')').join('\n'));
});
