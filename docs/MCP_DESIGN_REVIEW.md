# 공개 MCP 사례 검토와 반영

검토일: 2026-11-08. Korean Law MCP 소스 커밋 `3f7c7d8` (v4.15.23).

## Korean Law MCP에서 확인한 구조

- `tool-profiles.ts`의 10개 핵심 도구를 직접 노출하고 전문 도구는 발견·실행 경로로 분리한다. 자주 쓰는 별표 조회를 간접 경로로 돌렸을 때 호출 횟수가 증가한 사례도 주석에 남아 있다.
- 단일 법령은 검색·본문 조회로, 복합 질의만 `legal_research`로 보낸다. 8개 체인을 task 인자로 통합한다.
- 서버 instructions에 호출 순서를 모으고 도구 설명은 기능·입력에 집중한다. 자연어 날짜·조문·약칭을 정규화하고, 체인 내부에서 병렬 조회·출력 상한·실행 한도를 적용한다.
- TTL 캐시와 필요한 부분만 반환하는 본문 축약으로 전송량과 중복 호출을 줄인다.

확인한 소스: [도구 노출과 instructions](https://github.com/chrisryugj/korean-law-mcp/blob/3f7c7d8/src/lib/tool-profiles.ts), [통합 리서치](https://github.com/chrisryugj/korean-law-mcp/blob/3f7c7d8/src/tools/legal-research.ts), [내부 체인](https://github.com/chrisryugj/korean-law-mcp/blob/3f7c7d8/src/tools/chains.ts), [캐시](https://github.com/chrisryugj/korean-law-mcp/blob/3f7c7d8/src/lib/cache.ts).

이 검토는 정적 소스 분석이다. Korean Law MCP의 실제 응답 속도를 측정하거나 성남 예산 MCP보다 빠르다고 실험한 것은 아니다. 법제처 구조화 API와 예산 PDF·엑셀 코퍼스는 데이터 구조가 다르다.

## 성남 예산 MCP에 적용

기존 8개 도구를 유지한다. 이 규모에서 별도 도구 발견 단계를 추가하면 호출만 늘어나므로 `budget_research`를 바로 사용한다. 연도·문서종류 해석을 서버에 두고, 총괄표 조회는 검색을 생략하며, 일반 사업 검색은 기존 임베딩·벡터·키워드·MaxSim 리랭킹을 유지한다. `answer_card`, `query_interpretation`, `classification`을 제공해 GPT가 같은 자료를 반복 조회할 필요를 줄인다.

[MCP 공식 문서](https://modelcontextprotocol.io/docs/learn/server-concepts)는 모델이 도구를 선택하고 입력 스키마와 결과를 주고받는 구조를 설명한다. [OpenAI 검색·조회 계약](https://developers.openai.com/api/docs/mcp)에 맞춘 `search`/`fetch`, structuredContent와 공식 출처 URL도 유지했다.

별도 생성 모델이나 LLM 리랭커를 추가하지 않았다. 연결한 GPT가 최종 답을 작성한다.
