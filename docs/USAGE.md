# 성남 예산 MCP 호출 기록

## 운영 사이트 누적

운영 집계를 시작한 뒤 들어온 MCP 도구 호출은 [호출 현황 화면](https://seongnam-budget-research-20261107.gnudas0923.chatgpt.site/traffic)과 [집계 JSON](https://seongnam-budget-research-20261107.gnudas0923.chatgpt.site/api/traffic)에서 조회한다. MCP를 연결한 채팅에서는 `get_mcp_usage`로 같은 집계를 조회한다. 호출 횟수는 질문 하나를 처리할 때 검색과 원문 재조회가 각각 발생할 수 있다는 점을 고려해 해석한다.

## 운영 집계 시작 전 확인한 벤치마크

2026년 11월 24일 한국시간 21시 48분부터 23시 1분까지 조직별 검증 클라이언트가 남긴 기록이다. 이 기간의 일반 사용자 이용량과 사이트 전체 호출량은 확인할 수 없다.

| 지표 | 실적 |
| --- | ---: |
| 완료한 검증 세션 | 37회 |
| 서로 다른 문항 | 369개 |
| 반복 검증을 포함한 문항 실행 | 1,517회 |
| 검증 클라이언트의 MCP 도구 호출 | 5,851건 |
| 응답 수신 성공 / 실패 | 5,851건 / 0건 |

검색 `budget_research` 2,295건, 원문 페이지 조회 `get_budget_page` 3,390건, 문서 목록 조회 `list_budget_documents` 166건이다. 응답 수신 성공은 MCP 도구의 결과를 클라이언트가 받았다는 뜻이다. 답변의 정확도와 이용자 만족도는 별도로 평가한다. 과거 벤치마크와 운영 사이트 누적은 각각의 기간과 범위로 표시한다. [날짜·도구·세션별 증빙 JSON](usage/benchmark-baseline.json)

### 재현 방법

원본 검증 세션 폴더를 가진 운영자는 이 저장소의 루트에서 다음 명령을 실행한다. `RUNS` 자리에 보관된 `runs` 폴더를 지정한다.

```sh
python scripts/benchmark-usage.py RUNS --through-run 20261124T140040-holdout-185168 --output reproduced.json
git diff --no-index docs/usage/benchmark-baseline.json reproduced.json
```

스크립트는 완료된 세션마다 원래 질문별 호출 기록을 한 번씩 세고 세션의 호출·문항 합계와 대조한다. 세션 원본의 SHA-256과 질문별 원본 파일 해시 목록의 SHA-256을 증빙에 담는다. 재채점 결과, 연결 초기화, HTTP 재시도는 이 수치에 별도로 더하지 않는다. [집계 스크립트](../scripts/benchmark-usage.py)
