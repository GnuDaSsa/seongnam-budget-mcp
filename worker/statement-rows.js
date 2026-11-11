// 세출예산사업명세서("전체" 문서)의 쪽 본문을 순서대로 읽어 부서·정책·단위·세부사업·편성목·통계목 행으로 만든다.
// 순수 함수(입출력 없음). 원문에 인쇄된 값만 쓰며 알 수 없는 필드는 null로 둔다.
// 부서→정책→단위→세부사업→편성목→통계목 상태를 쪽 경계를 넘어 이어 가므로 이어지는 쪽의 첫 행도 경로를 잃지 않는다.
import { statementLine } from './quality.js';

const FUNDING_LABELS = new Set(['국', '도', '시', '기', '균']);
const OBJECT_CODE = /^(\d{3})\s+(\S.*)$/;
const STAT_CODE = /^(\d{2})\s+(\S.*)$/;
const DETAIL_LABEL = /^[○―\-–·]|\d[\d,]*원/;
const norm = v => String(v ?? '').replace(/\s+/g, '');

// 원문 정책 이름이 그대로 이 값일 때만 구분을 붙인다. 그 밖의 정책은 정책사업.
const POLICY_KINDS = ['행정운영경비', '재무활동'];
function policyKind(policy) {
  if (!policy) return null;
  const n = norm(policy);
  return POLICY_KINDS.find(k => n === k || n.startsWith(`${k}(`)) ?? '정책사업';
}

// 편성 문자열을 {budget_type, revision}으로 바꾼다. 알 수 없으면 null.
export function parseEdition(edition, revision) {
  if (edition && typeof edition === 'object') return { budget_type: edition.budget_type ?? null, revision: edition.revision ?? null };
  const text = String(edition ?? '');
  if (/본예산/.test(text)) return { budget_type: '본예산', revision: null };
  if (/추경/.test(text)) {
    const m = text.match(/(\d+)/);
    const r = revision ?? (m ? Number(m[1]) : null);
    return { budget_type: '추경', revision: Number.isInteger(r) ? r : null };
  }
  return { budget_type: null, revision: null };
}

// 섹션 제목(예: 2026년도추경1회교통사업전체, 2026년도본예산전체일반회계)에서 회계명을 읽는다.
export function parseSectionTitle(line) {
  const compact = norm(line).replace(/\(단위:?[^)]*\)$/, '');
  const m = compact.match(/^(\d{4})년도(본예산|추경\d+회)(.+)$/);
  if (!m) return null;
  const rest = m[3];
  let account = null;
  if (rest.startsWith('전체')) account = rest.slice(2);
  else if (rest.endsWith('전체')) account = rest.slice(0, -2);
  if (!account) return null;
  return { year: Number(m[1]), edition: m[2], account, summary_page: rest.startsWith('전체') };
}

function columnLabels(text) {
  const t = String(text);
  if (!/비교증감/.test(t)) return null;
  const previous = /기정액/.test(t) ? '기정액' : /전년도/.test(t) ? '전년도예산액' : null;
  return previous ? { budget: '예산액', previous, change: '비교증감' } : null;
}

function toAmounts(a) {
  return { budget: a.amount, previous: a.previous_amount, change: a.change };
}

// 구조 행(금액 3열 이름행, 편성목, 통계목, 재원 행)만 모은다. 세부 산출 근거(○, ―)와 금액 1열 행은 버린다.
function collectEntries(pages) {
  const entries = [];
  const warnings = [];
  let title = null;
  let labels = null;
  let previousPage = null;
  for (const page of pages) {
    // 쪽 번호가 이어지지 않으면 앞 쪽의 경로를 이어받지 않는다(일부 쪽만 받은 경우).
    const gap = previousPage !== null && page.page !== previousPage + 1;
    previousPage = page.page;
    const text = String(page.text ?? '');
    const lines = text.split('\n');
    let headerDepartment = null;
    for (const raw of lines) {
      const hd = raw.match(/^\s*부서:\s*(\S.*?)\s*$/);
      if (hd) { headerDepartment = hd[1]; break; }
    }
    for (const raw of lines) {
      const t = parseSectionTitle(raw.trim());
      if (t) {
        title = t;
        entries.push({ type: 'title', page: page.page, title: t });
        break;
      }
    }
    // 부서 헤더가 없는 쪽은 총괄표 등이므로 행으로 읽지 않는다.
    if (!headerDepartment) { entries.push({ type: 'barrier' }); continue; }
    labels = columnLabels(text) ?? labels;
    if (gap) entries.push({ type: 'barrier' });
    const unitMatch = text.match(/\(단위:\s*([^)\s]+)\)/);
    entries.push({ type: 'page', page: page.page, headerDepartment, reset: gap, amountUnit: unitMatch ? unitMatch[1] : null });
    lines.forEach((raw, index) => {
      if (!raw.trim()) return;
      const { label, indent, amounts } = statementLine(raw, index);
      if (!amounts || !label) return;
      if (FUNDING_LABELS.has(label)) {
        entries.push({ type: 'funding', page: page.page, line: index + 1, label, amounts, labels });
        return;
      }
      if (DETAIL_LABEL.test(label)) return;
      const numbersPrinted = raw.trim().split(/\s{2,}/).slice(1).filter(c => /^[△▲-]?\d[\d,]*$/.test(c.trim())).length;
      if (numbersPrinted < 3) return;
      const entry = { page: page.page, line: index + 1, indent, label, amounts, labels };
      const obj = label.match(OBJECT_CODE);
      const stat = label.match(STAT_CODE);
      if (obj) entries.push({ ...entry, type: 'object', code: obj[1], name: obj[2] });
      else if (stat) entries.push({ ...entry, type: 'stat', code: stat[1], name: stat[2] });
      else if (/^[가-힣A-Za-z0-9(「]/.test(label)) entries.push({ ...entry, type: 'name' });
    });
  }
  return { entries, warnings };
}

// 이름 행을 부서/정책/단위/세부사업으로 나눈다. 세부사업은 다음 구조 행이 3자리 편성목인 이름 행이다.
function classifyNames(entries, lenient = false) {
  const structural = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => ['name', 'object', 'stat', 'barrier'].includes(e.type));
  structural.forEach(({ e }, k) => {
    if (e.type !== 'name') return;
    const next = structural[k + 1]?.e ?? null;
    if (e.indent === 0) { e.level = 'department'; return; }
    if (next?.type === 'object') { e.level = 'business'; return; }
    // 쪽이 끊겼거나 문서가 잘려 다음 구조 행을 볼 수 없을 때만 들여쓰기 힌트(세부사업 = 3)로 보충한다.
    if (lenient && e.indent === 3 && (!next || next.type === 'barrier' || (next.type === 'name' && next.indent <= e.indent))) { e.level = 'business'; return; }
    e.level = null;
  });
  structural.forEach(({ e }, k) => {
    if (e.type !== 'name' || e.level) return;
    let next = null;
    for (let j = k + 1; j < structural.length; j += 1) {
      const c = structural[j].e;
      if (c.type === 'name') { next = c; break; }
      if (c.type === 'object' || c.type === 'barrier') break;
    }
    const nextIsChildName = next && next.level == null && next.indent > e.indent;
    e.level = nextIsChildName || e.indent <= 1 ? 'policy' : 'unit';
  });
}

// 쪽 목록으로 행을 만들고 경고를 함께 돌려준다.
// options.lenient: 일부 쪽만 받은 경우(부서 개요)에 쪽 끝의 세부사업을 들여쓰기 힌트로 보충한다. 색인 구축·검증에는 쓰지 않는다.
export function parseStatement(pages, meta = {}, options = {}) {
  const { entries, warnings } = collectEntries([...pages].sort((a, b) => a.page - b.page));
  classifyNames(entries, options.lenient === true);
  const { budget_type, revision } = parseEdition(meta.edition, meta.revision);
  const base = {
    document_id: meta.document_id ?? null,
    year: meta.year ?? null,
    budget_type,
    revision,
    edition: budget_type === '추경' ? `${revision ?? '?'}회 추경` : budget_type,
    account_group: meta.account ?? null,
  };
  const rows = [];
  let account = meta.account ?? null;
  const st = { department: null, policy: null, unit: null, business: null, object: null, stat: null };
  let last = null;
  let amountUnit = meta.unit ?? null; // 쪽 머리글의 (단위:천원) 표기. 없으면 meta.unit, 그것도 없으면 null.
  const pathOf = () => ({
    account,
    department: st.department,
    policy: st.policy,
    unit: st.unit,
    business: st.business,
    object: st.object,
    stat: st.stat,
  });
  for (const e of entries) {
    if (e.type === 'title') {
      if (e.title.account !== account) {
        account = e.title.account;
        Object.assign(st, { department: null, policy: null, unit: null, business: null, object: null, stat: null });
        last = null;
      }
      continue;
    }
    if (e.type === 'barrier') continue;
    if (e.type === 'page') {
      if (e.reset) { Object.assign(st, { department: null, policy: null, unit: null, business: null, object: null, stat: null }); last = null; }
      if (!st.department) st.department = e.headerDepartment;
      if (e.amountUnit) amountUnit = e.amountUnit;
      continue;
    }
    if (e.type === 'funding') {
      if (last) {
        const target = last;
        target.funding ??= {};
        target.funding_detail ??= {};
        if (target.funding[e.label] === undefined) {
          target.funding[e.label] = e.amounts.amount;
          target.funding_detail[e.label] = toAmounts(e.amounts);
        }
      }
      continue;
    }
    let level;
    if (e.type === 'object') { st.object = { code: e.code, name: e.name }; st.stat = null; level = 'object'; }
    else if (e.type === 'stat') { st.stat = { code: e.code, name: e.name }; level = 'stat'; }
    else if (e.level === 'department') {
      Object.assign(st, { department: e.label, policy: null, unit: null, business: null, object: null, stat: null }); level = 'department';
    } else if (e.level === 'policy') {
      Object.assign(st, { policy: e.label, unit: null, business: null, object: null, stat: null }); level = null;
    } else if (e.level === 'unit') {
      Object.assign(st, { unit: e.label, business: null, object: null, stat: null }); level = null;
    } else {
      st.business = e.label; st.object = null; st.stat = null; level = 'business';
    }
    if (!level) { last = null; continue; }
    const path = pathOf();
    const row = {
      ...base,
      page: e.page,
      source_line: e.line,
      ...path,
      level,
      amounts: toAmounts(e.amounts),
      amount_unit: amountUnit,
      column_labels: e.labels ?? null,
      columns_verified: !!e.labels && e.amounts.columns_verified === true,
      funding: null,
      funding_detail: null,
      policy_kind: policyKind(path.policy),
      source_excerpt: e.amounts.source_excerpt,
    };
    row.account = account;
    rows.push(row);
    last = row;
  }
  return { rows, warnings };
}

export function parseStatementRows(pages, meta = {}, options = {}) {
  return parseStatement(pages, meta, options).rows;
}

// 부서 합계 행과 세부사업 합계를 비교한다. 본예산에서 모든 부서가 맞아야 verified.
export function reconcileStatement(rows = []) {
  const groups = new Map();
  for (const r of rows) {
    if (r.level !== 'department' && r.level !== 'business') continue;
    const key = JSON.stringify([r.account, r.department]);
    if (!groups.has(key)) groups.set(key, { account: r.account, department: r.department, totals: [], business_sum: 0, business_count: 0, page: null });
    const g = groups.get(key);
    if (r.level === 'department') { g.totals.push(r.amounts.budget); g.page ??= r.page; }
    else { g.business_sum += r.amounts.budget; g.business_count += 1; }
  }
  const departments = [...groups.values()].filter(g => g.totals.length).map(g => ({
    account: g.account,
    department: g.department,
    page: g.page,
    printed_total: g.totals.length === 1 ? g.totals[0] : null,
    business_sum: g.business_sum,
    business_count: g.business_count,
    reconciled: g.totals.length === 1 && g.totals[0] === g.business_sum && g.business_count > 0,
  }));
  const orphans = [...groups.values()].filter(g => !g.totals.length && g.business_count).length;
  const reconciledCount = departments.filter(d => d.reconciled).length;
  const types = new Set(rows.map(r => r.budget_type));
  const sum = departments.reduce((n, d) => n + (d.printed_total ?? 0), 0);
  const accounts = [...new Set(departments.map(d => d.account))].map(account => {
    const ds = departments.filter(d => d.account === account);
    return { account, department_count: ds.length, reconciled_count: ds.filter(d => d.reconciled).length, account_total_sum: ds.reduce((n, d) => n + (d.printed_total ?? 0), 0) };
  });
  let inventory_status = 'partial';
  if (types.size === 1 && types.has('추경')) inventory_status = 'change_list';
  else if (types.size === 1 && types.has('본예산') && departments.length > 0 && reconciledCount === departments.length && !orphans) inventory_status = 'verified';
  return {
    departments,
    accounts,
    overall: { department_count: departments.length, reconciled_count: reconciledCount, account_total_sum: sum, unmatched_business_groups: orphans },
    inventory_status,
  };
}
