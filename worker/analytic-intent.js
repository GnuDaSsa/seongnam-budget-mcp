// Pure, read-only detection of analytic intent in a budget question.
// Never assumes an edition or account: unstated values are reported as false/null for the caller to decide.
// Department matching reuses worker/departments.js; "예산과" is only a department in the contexts that module accepts.
import {normalizeDepartment, requestedDepartments} from './departments.js';

const DESC = /가장\s*(?:큰|많은|높은|비싼|많이)|최대|최고|상위|TOP\s*\d*|top\s*\d*|순위|제일\s*(?:큰|많은)|1위/;
const ASC = /가장\s*(?:작은|적은|낮은|적게)|최소|최저|하위|제일\s*(?:작은|적은)/;
const SUPERLATIVE = /가장|최대|최고|최소|최저|제일|1위/;
const STAT = /통계목|시설비|편성목|목별|(?<!\d)\d{3}-\d{2}(?!\d)/;
const CODE = /(?<!\d)(\d{3}-\d{2})(?!\d)/;
const DEPARTMENT_TARGET = /부서별\s*(?:총액|총예산)?|부서\s*(?:총액|총예산)|상위\s*\d*\s*(?:개\s*)?부서|(?:가장|최대|최소)\s*(?:큰|많은|작은|적은)\s*부서/;
const ACCOUNTS = [['일반회계', /일반회계/], ['기타특별회계', /기타특별회계/], ['상수도', /상수도/], ['하수도', /하수도/], ['공영개발사업', /공영개발/]];

function countN(q) {
 const top = q.match(/(?:상위|하위|TOP|top)\s*(\d+)/);
 if (top) return Number(top[1]);
 const counted = q.match(/(?<![\d-])(\d+)\s*(?:개|곳)/);
 if (counted) return Number(counted[1]);
 const first = q.match(/(?<!\d)1위/);
 if (first) return 1;
 return null;
}

function departmentIndex(departments) {
 return (departments || []).map(d => {
  if (typeof d === 'string') return {key: normalizeDepartment(d), name: d};
  const name = d.name ?? d.key;
  return {key: d.key ?? normalizeDepartment(name), name};
 }).filter(d => d.key);
}

function detectDepartments(query, departments) {
 const index = departmentIndex(departments);
 if (!index.length) return [];
 return requestedDepartments(query, {departments: index}).map(d => d.name);
}

export function detectAnalyticIntent(query, {departments = []} = {}) {
 const q = String(query || '').normalize('NFKC');
 const named = detectDepartments(q, departments);
 const districtCount = new Set(q.match(/수정구|중원구|분당구/g) || []).size;

 // Ranking: "예산과", "예산액", "본예산" contain 예산 but are not ranking words.
 let ranking = null;
 const desc = DESC.exec(q), asc = ASC.exec(q);
 if (desc || asc) {
  const direction = desc && (!asc || desc.index < asc.index) ? 'desc' : 'asc';
  const code = CODE.exec(q)?.[1] ?? null;
  let level;
  if (code || STAT.test(q)) level = 'stat';
  else if (DEPARTMENT_TARGET.test(q) || (/부서/.test(q) && !/세부사업|사업/.test(q))) level = 'department';
  else level = 'business';
  let n = countN(q);
  if (n === null && SUPERLATIVE.test(q)) n = 1;
  ranking = {
   direction,
   n,
   level,
   code,
   department: level !== 'department' && named.length === 1 ? named[0] : null,
  };
 }

 const department_sum = /합계|합산|더해|더하|합치/.test(q) && (named.length >= 2 || (!named.length && districtCount >= 2));
 const edition_compare = /기정액|경정액|증감/.test(q) || (/본예산/.test(q) && /추경|추가경정/.test(q));
 const funding = /국비|도비|시비|재원|국도비/.test(q);
 const explicit_edition = /본예산|추경|추가경정|결산/.test(q);
 let explicit_account = null, best = Infinity;
 for (const [name, re] of ACCOUNTS) {
  const m = re.exec(q);
  if (m && m.index < best) { best = m.index; explicit_account = name; }
 }

 const kinds = [];
 if (ranking) kinds.push('ranking');
 if (department_sum) kinds.push('department_sum');
 if (edition_compare) kinds.push('edition_compare');
 if (funding) kinds.push('funding');

 return {kinds, ranking, department_sum, edition_compare, funding, explicit_edition, explicit_account};
}
