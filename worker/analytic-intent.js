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

const DISTRICTS = ['수정구', '중원구', '분당구'];
const SUM_WORDS = /합계|합산|더해|더하|합치/;
const DIFFERENCE_WORDS = /차액|차이|격차|얼마나\s*(?:더|덜)|빼면|뺀\s*(?:값|금액|액수)|뺄\s*때|뺐을/;
// 질문 순서(A와 B의 차액 = A-B)와 다른 방향을 만들 수 있는 표현. 있으면 방향을 확정하지 않는다.
const DIRECTION_CUES = /보다|얼마나\s*(?:더|덜)|(?:더|덜)\s*(?:많|적|큰|작|높|낮)|빼|뺀|뺄|뺐/;
// "중원구는 제외해줘", "분당구 빼고". "빼면"은 차액 표현("A에서 B를 빼면")이라 제외로 보지 않는다.
const EXCLUSION_TAIL = '(?:은|는|을|를|도|가|이)?(?:제외|빼고|빼서|빼지|뺀|말고)';

const compact = s => normalizeDepartment(s);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exclusionRe = token => new RegExp(escapeRe(token) + EXCLUSION_TAIL, 'g');
const districtOf = key => DISTRICTS.find(d => key.startsWith(d)) ?? null;

// 차액 의도. 합계 의도와 별개로 판정하며, 제외 표현("중원구는 제외")은 차액 표현이 아니다.
export function detectDifferenceIntent(query) {
 const q = String(query || '').normalize('NFKC');
 const withoutExclusion = q.replace(/\S*?(?:은|는|을|를|도|가|이)?\s*(?:제외|빼고|빼서|빼지|말고)\S*/g, ' ');
 return {
  difference: DIFFERENCE_WORDS.test(withoutExclusion),
  direction_cue: DIRECTION_CUES.test(withoutExclusion),
  sum: SUM_WORDS.test(q),
 };
}

// 차액 피연산자: 질문에 나온 부서 중 제외 표현이 붙은 부서·구를 빼고 질문 순서로 정렬한다.
// order_known=false이면 질문 위치를 확정하지 못했거나 방향을 바꿀 수 있는 표현이 있어 A-B 방향을 주장하지 않는다.
export function differenceOperands(query, departmentNames = []) {
 const q = String(query || '').normalize('NFKC');
 const nq = compact(q);
 const excluded = [];
 const kept = [];
 for (const name of departmentNames) {
  const key = compact(name);
  const district = districtOf(key);
  const byName = exclusionRe(key).test(nq);
  const byDistrict = !!district && !nq.includes(key) && exclusionRe(district).test(nq);
  (byName || byDistrict ? excluded : kept).push(name);
 }
 // 상위 단계에서 이미 부서 목록에서 빠진 구("중원구는 제외")도 질문 문구에서 찾아 제외 목록에 남긴다. 피연산자는 아니다.
 for (const district of DISTRICTS) {
  if (exclusionRe(district).test(nq) && !excluded.some(n => compact(n).startsWith(district)) && !kept.some(n => compact(n).startsWith(district))) {
   // 남은 부서가 구 접두어 뒤 이름을 공유하면("수정구/분당구 사회복지과") 제외 구에도 같은 이름을 붙여 보여 준다.
   const suffixes = new Set(kept.map(n => { const k = compact(n), d = districtOf(k); return d ? k.slice(d.length) : ''; }));
   const [suffix] = suffixes.size === 1 ? suffixes : [''];
   excluded.push(district + (suffix || ''));
  }
 }
 // 제외 표현 안의 이름은 위치 판단에서 뺀다.
 let positionText = nq;
 for (const name of departmentNames) {
  const key = compact(name);
  positionText = positionText.replace(exclusionRe(key), '');
  const district = districtOf(key);
  if (district) positionText = positionText.replace(exclusionRe(district), '');
 }
 const positioned = kept.map(name => {
  const key = compact(name);
  let at = positionText.indexOf(key);
  if (at < 0) { const d = districtOf(key); at = d ? positionText.indexOf(d) : -1; }
  return {name, at};
 });
 const located = positioned.every(p => p.at >= 0) && new Set(positioned.map(p => p.at)).size === positioned.length;
 const ordered = located ? [...positioned].sort((x, y) => x.at - y.at).map(p => p.name) : kept;
 const mentionedDistricts = new Set(DISTRICTS.filter(d => positionText.includes(d)));
 return {operands: ordered, excluded, order_located: located, mentioned_districts: mentionedDistricts.size};
}

// excluded_budget_types: resolveQuery가 "추경 제외"·"추경 빼고" 같은 표현에서 해석한 편성. 제외한 편성은 비교 대상이 될 수 없다.
export function detectAnalyticIntent(query, {departments = [], excluded_budget_types = []} = {}) {
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
 const editionExcluded = (excluded_budget_types || []).some(t => t === '본예산' || t === '추경');
 const edition_compare = !editionExcluded && (/기정액|경정액|증감/.test(q) || (/본예산/.test(q) && /추경|추가경정/.test(q)));
 const diff = detectDifferenceIntent(q);
 const department_difference = diff.difference && (named.length >= 2 || districtCount >= 2);
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
 if (department_difference) kinds.push('department_difference');
 if (edition_compare) kinds.push('edition_compare');
 if (funding) kinds.push('funding');

 return {kinds, ranking, department_sum, department_difference, difference_direction_cue: diff.direction_cue, edition_compare, funding, explicit_edition, explicit_account};
}
