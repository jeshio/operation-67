import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { flattenGraph, checkSources } from '../scripts/security/dependency-review.mjs';
test('archive rejects dangerous paths and links before extracting files',()=>{
 mkdirSync('test-artifacts/security',{recursive:true});
 const r=spawnSync('python3',['scripts/security/test-archive-paths.py'],{encoding:'utf8',env:{...process.env,PYTHONOPTIMIZE:'1'}});assert.equal(r.status,0,r.stderr);
});
test('dependency sources and graph comparisons fail closed on unexpected formats',()=>{
 assert.doesNotThrow(()=>checkSources('excludeLinksFromLockfile: false\nresolution: {tarball: https://registry.npmjs.org/a.tgz}'));
 for(const value of ['resolution: {tarball: http://evil.test/a}', 'resolution: {tarball: https://evil.test/a}', 'version: link:../other'])assert.throws(()=>checkSources(value));
 const graph=flattenGraph([{dependencies:{a:{version:'1.0.0',dependencies:{b:{version:'2.0.0'}}}}}]);assert.deepEqual([...graph.keys()],['a@1.0.0','b@2.0.0']);assert.throws(()=>flattenGraph({dependencies:{a:{}}}));
});
