import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonStatus} from '../worker/comparison.js';
test('comparison never asserts equivalence and surfaces missing years and mixed types',()=>{
 const s=comparisonStatus([2024,2025,2026],[{evidence:[{budget_type:'결산',source_family:'other'}]},{evidence:[]},{evidence:[{budget_type:'본예산',source_family:'expenditure'}]}]);
 assert.equal(s.status,'unverified');assert.deepEqual(s.missing_years,[2025]);assert.equal(s.mixed_budget_types,true);
 assert.equal(comparisonStatus([2025,2026],[{evidence:[{budget_type:'본예산'}]},{evidence:[{budget_type:'본예산'}]}]).status,'unverified');
});
