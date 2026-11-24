export function trafficPage() {
  return String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>도구 호출 현황 · 성남 예산 MCP</title>
  <style>
    :root { color-scheme: light; --paper: #fffef9; --ink: #18352f; --line: #d9ded4; --muted: #51655c; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f4ee; color: var(--ink); font: 1rem/1.65 'Pretendard', 'Malgun Gothic', system-ui, sans-serif; }
    header { background: var(--paper); border-bottom: 1px solid var(--line); padding: 1rem 5vw; }
    header nav, main { max-width: 60rem; margin: auto; }
    nav { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    nav strong { font-size: 1.15rem; }
    a { color: inherit; text-underline-offset: .2em; }
    a:focus-visible, [tabindex]:focus-visible { outline: 2px solid #9b3a1e; outline-offset: 4px; }
    main { padding: 2.5rem 5vw 4rem; }
    h1 { font-size: clamp(2rem, 5vw, 3.2rem); line-height: 1.15; margin: 0 0 1rem; }
    h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; }
    p { max-width: 52rem; }
    #period, #status, dt { color: var(--muted); }
    dl { display: flex; flex-wrap: wrap; margin: .5rem 0; background: var(--paper); border-top: 2px solid var(--ink); }
    dl > div { flex: 1 1 8rem; padding: .85rem 1rem; border-bottom: 1px solid var(--line); }
    dt { font-size: .9rem; } dd { margin: 0; font-size: 1.35rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .table-wrap { overflow-x: auto; } table { width: 100%; border-collapse: collapse; background: var(--paper); font-variant-numeric: tabular-nums; }
    th, td { text-align: right; padding: .6rem .8rem; white-space: nowrap; border-bottom: 1px solid var(--line); }
    th:first-child { text-align: left; } thead { color: var(--muted); }
    footer { margin-top: 2rem; }
  </style>
</head>
<body>
  <header><nav aria-label="주 메뉴"><strong>성남 예산 MCP</strong><a href="/">예산 검색</a></nav></header>
  <main>
    <h1>도구 호출 현황</h1>
    <p>한 질문에 예산 검색과 원문 확인을 한 번씩 수행하면 2건으로 셉니다. 질문자 수와 웹페이지 방문 수는 집계 대상에서 제외합니다.</p>
    <p id="status" role="status" aria-live="polite">호출 기록을 불러오는 중입니다.</p>
    <noscript><p>자바스크립트를 켜거나 아래의 집계 데이터 링크에서 수치를 확인하세요.</p></noscript>
    <section id="report" aria-label="누적 및 일별 호출 통계" hidden>
      <h2>누적 호출</h2>
      <p id="period"></p>
      <dl>
        <div><dt>전체</dt><dd id="total_calls"></dd></div>
        <div><dt>검증용</dt><dd id="benchmark_calls"></dd></div>
        <div><dt>미분류</dt><dd id="unclassified_calls"></dd></div>
        <div><dt>성공</dt><dd id="success_calls"></dd></div>
        <div><dt>오류</dt><dd id="error_calls"></dd></div>
      </dl>
      <p>검증용은 벤치마크로 표시된 호출입니다. 미분류에는 출처를 구분할 수 없는 호출이 포함됩니다.</p>
      <h2 id="daily-title">일별 호출</h2>
      <div class="table-wrap" tabindex="0" role="region" aria-labelledby="daily-title">
        <table aria-labelledby="daily-title">
          <thead><tr><th scope="col">날짜</th><th scope="col">전체</th><th scope="col">검증용</th><th scope="col">미분류</th><th scope="col">성공</th><th scope="col">오류</th></tr></thead>
          <tbody id="daily"></tbody>
        </table>
      </div>
    </section>
    <footer><a href="/api/traffic">집계 데이터(JSON)</a> · <a href="https://github.com/GnuDaSsa/seongnam-budget-mcp/blob/main/docs/USAGE.md">과거 검증 기록과 집계 기준</a></footer>
  </main>
  <script>
    async function loadTraffic() {
      const status = document.getElementById('status');
      const fields = ['total_calls', 'benchmark_calls', 'unclassified_calls', 'success_calls', 'error_calls'];
      const format = new Intl.NumberFormat('ko-KR');
      const validDate = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day);
      const validCounts = entry => entry && fields.every(field => Number.isSafeInteger(entry[field]) && entry[field] >= 0);
      try {
        const response = await fetch('/api/traffic');
        if (!response.ok) throw new Error('조회 실패');
        const data = await response.json();
        if (!validCounts(data) || !Array.isArray(data.daily) || typeof data.timezone !== 'string' ||
            (data.total_calls > 0 && (!validDate(data.first_day) || !validDate(data.last_day))) ||
            !data.daily.every(row => validCounts(row) && validDate(row.day))) throw new Error('집계 형식 오류');
        for (const field of fields) document.getElementById(field).textContent = format.format(data[field]) + '건';
        document.getElementById('period').textContent = data.total_calls > 0
          ? '첫 기록 ' + data.first_day + ' · 최근 기록 ' + data.last_day + ' · ' + data.timezone + ' 기준'
          : '집계 시작 후 기록된 도구 호출이 없습니다.';
        const body = document.getElementById('daily');
        for (const day of data.daily.slice().sort((a, b) => b.day.localeCompare(a.day))) {
          const row = body.insertRow();
          const heading = document.createElement('th');
          heading.scope = 'row';
          heading.textContent = day.day;
          row.appendChild(heading);
          for (const field of fields) row.insertCell().textContent = format.format(day[field]);
        }
        document.getElementById('report').hidden = false;
        status.textContent = '';
      } catch {
        status.textContent = '지금은 호출 기록을 불러올 수 없습니다. 잠시 후 새로고침해 주세요.';
      }
    }
    loadTraffic();
  </script>
</body>
</html>`;
}
