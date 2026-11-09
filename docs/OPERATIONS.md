# 실행·갱신·복구 안내

## 현재 공개 주소

- 사이트: https://seongnam-budget-research-20261107.gnudas0923.chatgpt.site
- 공개 MCP: https://seongnam-budget-research-20261107.gnudas0923.chatgpt.site/public-mcp
- 전송: Streamable HTTP의 JSON 응답, POST, 인증 없음

MCP 연결에는 위 공개 주소를 사용한다. 사이트 플랫폼의 /mcp 주소는 개인용 자동 플러그인 인증 경로여서 외부 공개 연결과 구분한다.

## 내려받은 소스로 실행

프로젝트 루트에서 Python 3.13과 Node.js 22 이상으로 실행한다. 공개 스냅샷이 들어 있는 소스 패키지는 원본 수집 없이 바로 빌드·조회할 수 있다.

```powershell
node scripts/build.mjs
node --test tests/worker.test.mjs
node scripts/dev.mjs
```

http://127.0.0.1:8765 에서 열린다. 운영 중인 프로세스는 터미널에서 Ctrl+C로 종료한다.

## 자료 갱신

```powershell
python -m pip install -r requirements.txt
python -X utf8 pipeline/collect.py --discover
python -X utf8 pipeline/discover_related.py
python -X utf8 pipeline/collect.py --collect --workers 2
python -X utf8 pipeline/parse_office.py
python -X utf8 pipeline/audit_metadata.py
python -X utf8 pipeline/status.py
python -X utf8 pipeline/build_snapshot.py
python -X utf8 pipeline/write_report.py
python -X utf8 -m unittest discover -s tests -p test_pipeline.py -v
node scripts/build.mjs
node --test tests/worker.test.mjs
node scripts/validate-artifact.mjs
```

수집 프로세스는 한 번에 하나만 실행한다. workers는 1~3이다. 오류는 documents.error에 기록하고 다음 --collect가 discovered/failed를 재시도한다. 다운로드에는 HTTPS·공식 호스트 제한, 용량 한도 1GB, 재시도·타임아웃이 있다. .part 파일은 완료 파일로 취급하지 않는다. ZIP 내부 경로를 파일시스템에 풀지 않는다.

관련 게시판 탐색은 기본적으로 페이지와 첨부 목록을 다시 읽는다. --cached는 네트워크 없이 기존 탐색 자료를 재사용할 때만 지정한다. 이미 다운로드한 원본은 다시 받지 않는다. 같은 URL의 원본 교체를 자동 감지하는 기능은 아직 없다. 교체가 확인되면 기존 원본·DB를 백업한 후 해당 문서를 재수집하는 작업을 별도 검증해야 한다. 신규 파일 발견과 기존 파일 변경 감지는 다른 상태다.

파서 개선 후 특정 형식을 다시 읽으려면 `python pipeline/parse_office.py --reparse-format hwpx`처럼 지정한다. 인용 위치·수치가 달라진 문서를 검토한 뒤 색인한다. HWP 파서는 일반적인 압축 해제 설치의 리소스 경로를 사용하며, setuptools는 보안 수정 버전으로 고정한다.

## 배포

현재 .openai/hosting.json의 project_id를 유지한다. 소스 및 snapshot을 빌드·검증한 뒤 Sites 공식 source workflow로 동일 커밋을 push하고 dist의 배포 아카이브를 만든다. save_site_version으로 저장하고 deploy_site_version으로 게시한다. 공개 audience를 유지하며 private 배포 함수를 사용하지 않는다. 소스를 저장하는 동안 파일을 수정하지 않는다.

원본 PDF·data·.env·토큰은 Git에 넣지 않는다. 배포 성공 후 다음을 로그인 없이 확인한다.

1. GET /api/status: 실제 스냅샷 건수 및 asset_binding=true.
2. GET /api/search?query=노인일자리&year=2026: 성남시 원문 근거 반환.
3. POST /public-mcp: server/discover, tools/list, tools/call.
4. PDF의 쪽수, HWP/Excel 본문 블록, 원문 링크.

## 백업과 장애 대응

수집을 멈춘 뒤 data/raw와 SQLite의 일관된 backup을 함께 보관한다. WAL 파일이 있을 때 budget.sqlite만 복사하면 최신 트랜잭션이 빠질 수 있으므로 Python sqlite3.Connection.backup을 사용한다. 소스와 snapshot을 별도로 보관하면 원본 DB가 없어도 공개 검색 버전을 재배포할 수 있다.

검색 실패가 발생하면 /api/status와 정적 corpus 자산 조회, 배포 버전, Worker 로그 순서로 확인한다. 새 수집본이 실패하면 이전 저장 버전을 재배포한다. 사이트의 실패 건수·미추출 페이지 수를 숨기지 않는다.

## 운영 범위

자동 갱신 일정은 등록하지 않았다. 원문 표의 정확한 열 구조, OCR, 부서별 산발 게시물 탐색, 허용 경로가 필요한 재정공시, 대규모 동시접속 부하, 트래픽별 운영비는 남은 검증 항목이다. 공개 주소가 동작한다는 사실과 전체 수집·장기 운영 검증 완료는 구분한다.

## 인계 패키지

seongnam-budget-source.zip에는 실행 코드·문서·배포용 검색 스냅샷이 들어 있다. budget-text.sqlite.gz는 수집 상태와 추출 본문의 SQLite 백업이다. 압축을 풀어 프로젝트 data/budget.sqlite에 복원한다. 원본 약 9.2GB는 이 패키지에 중복 포함하지 않으며 작업 폴더 data/raw에 보관되어 있다. 원본을 다른 운영 환경으로 이전할 때 별도로 복사한다. 파일 해시는 SHA256SUMS.json에서 확인한다.


## 2026-11-08 의미 검색 구현

- 임베딩: `minishlab/potion-multilingual-128M`, revision `73908c3438cf03b6a01bcb9611d62b23d0726f08`. BGE-M3를 증류한 다국어 정적 토큰 임베딩, 256차원, mean pooling + L2 정규화. 라이선스 MIT.
- 범위: 검색 가능 원문 112,386개 위치를 모두 596,870개 구간으로 벡터화. 구간은 최대 800 Unicode 문자, 겹침 120자, 가능한 줄바꿈을 경계로 사용한다. 미추출 PDF·실패 자료까지 벡터화했다는 뜻은 아니다.
- 저장·검색: 대칭 int8 벡터, float32 scale, cosine IVF256, nprobe 24. 모든 토큰 어휘·가중치는 정적 자산으로 보관하고, 원문에서 사용한 토큰 15,507개는 작은 공통 캐시에 올린다. 질문도 같은 모델로 서버에서 임베딩한다.
- 결합: 벡터 후보 64개와 키워드 후보 20개를 RRF(k=60)로 결합하고 상위 32개 후보를 재정렬한다. 연도·유형·회차·분류 필터는 벡터 후보 단계부터 적용한다.
- 리랭커: `potion-token-maxsim-v1`. 질문과 본문의 토큰 임베딩으로 MaxSim을 계산한다. 최종 점수 = 0.55 × chunk cosine + 0.35 × 학습된 토큰 norm으로 가중한 평균 token MaxSim + 0.10 × 정규화 RRF. 별도로 학습한 cross-encoder나 ColBERT 모델이 아니다. 이 경량 방식의 정밀도는 별도 사람 정답셋으로 추가 검증해야 한다.
- 응답: `retrieval`에 실제 모델·탐색 수·후보 수·재정렬 여부·소요 시간을 반환한다. 근거마다 cosine/MaxSim/RRF/원문 구간 위치를 포함한다. `mode=hybrid`가 기본이며 `vector`, `lexical` 비교 모드도 제공한다.
- 공개 운영: Sites Worker 내부에서 추론과 벡터 검색을 실행한다. 외부 모델 API, 방문자 로그인, PC 상시 실행, 임시 터널이 필요하지 않다. API 키를 만들지 않았다. 사이트와 `/public-mcp`는 공개다.
- 한계: 정적 임베딩은 문맥형 Transformer보다 어순·부정·정교한 문맥 구분이 약할 수 있다. 검색 근거를 연결된 GPT가 읽고 인용하여 답한다. OCR·자동 금액 합산·사이트 자체 생성 챗봇·자동 최신화는 여전히 미구현이다.

모델 근거: https://huggingface.co/minishlab/potion-multilingual-128M
토큰 단위 late interaction 아이디어: https://arxiv.org/abs/2004.12832 (본 구현이 ColBERT 모델이라는 뜻은 아님)

### 의미 색인 재생성

1. `pipeline/download_model.py`로 고정 revision의 모델을 work/models/potion에 받는다.
2. `requirements-rag.txt`를 별도 Python 환경에 설치한다.
3. 원문 스냅샷 생성 후 `python pipeline/build_vectors.py`, `python pipeline/build_ann.py`를 순서대로 실행한다.
4. `python pipeline/evaluate_ann.py`, `npm ci`, `npm run build`, `node --max-old-space-size=96 --test tests/*.test.mjs`로 검사한다.
5. 실제 한국어 질문과 원문 위치를 확인하고 공개 버전을 배포한다. 원문 스냅샷이 바뀌면 의미 색인도 반드시 다시 생성한다. 빌드는 catalog SHA-256 불일치를 거부한다.
6. Sites Git의 push 64MiB 제한 때문에 신규 모델/벡터 자산은 약 40MiB 이하 커밋 묶음으로 전송한다. 중간 커밋은 배포하지 않고, 최종 전체 소스만 빌드·저장·배포한다.

서버 메모리 캐시는 어휘 바이너리·공통 토큰·중심점·페이지/문서 매핑으로 제한한다. 원본 float32 모델과 임베딩 NPY는 work에만 남기고 배포하지 않는다. int8 모델과 검색 인덱스는 소스 패키지에 포함한다.

모델 가중치 정적 저장소: https://seongnam-budget-model-assets-20261108.gnudas0923.chatgpt.site (공개). Sites의 256MiB 배포 아카이브 제한에 맞춰 드문 질문 토큰의 int8 가중치 116MB를 별도 공개 Sites로 분리했다. 원문에서 사용한 토큰·어휘·IVF 인덱스·본문은 검색 서버에 유지한다. 런타임은 고정한 이 origin의 tokens-N.bin.gz만 읽으며 임의 URL을 받지 않는다. 저장소에 모델 추론 API나 API 키는 없다. 모델 공급원 변경 시 main Worker의 origin 및 manifest를 함께 바꾸고 검사한다.

모델 자산 배포는 `work/seongnam-model-assets`의 별도 Sites 프로젝트에서 `assets/tokens-*.bin.gz` → `node build.mjs` → 공개 배포 순서로 진행한다. 이 파일들은 main 프로젝트 `snapshot/semantic`에도 포함하므로 소스 패키지에서 복구할 수 있다. main build는 tokens 파일을 자신의 dist/client로 복사하지 않는다.

## 2026-11-08 MCP 중심 연동 보완

서비스 역할은 RAG 검색과 원문 근거 반환이다. 생성 답변은 연결된 GPT가 수행한다. 서버에 Luna 답변·LLM 리랭킹·모델 API 키 의존성을 추가하지 않는다. 공개 /public-mcp의 익명 접근을 유지한다.

기본 진입점은 budget_research: 검색·리랭킹 후 최대 4개의 원문 근거, 위치, 단위, 출처, 수집 한계를 함께 반환한다. 각 근거는 최대 6,000 Unicode 문자이며 잘림과 원문 구간을 명시한다. 이미 충분한 근거를 받은 GPT는 같은 검색·상태·전문 조회를 반복할 필요가 없다. 비교 질문은 연도별로 조회하고 편성 구분을 맞춘다.

ChatGPT 리서치 호환 search(query) → fetch(id)를 추가했다. id/title/url 및 전문·metadata, 출력 JSON Schema를 제공한다. 기존 도구 5개도 유지하여 총 8개 읽기 전용 도구를 노출한다. GPTs Actions 호환 /openapi.json은 같은 /api/research, /api/page, /api/status를 기술한다. 상세 연결은 MCP_CONNECT.md를 따른다.

성능 변경: 동일 샤드의 페이지·본문을 묶어 읽고, 전체 키워드 후보 순위에 필요한 문서 인덱스·문자 수·단위 여부·정확한 중복 식별자를 rank.bin.gz에 저장한다. 112,386개 위치의 누락과 catalog SHA-256을 검증한다. build.mjs가 매 빌드에 이 자산을 재생성한다. 검색 결과 캐시는 인스턴스 메모리에서 5분/12건/약 2MB로 제한하며 필터별로 분리한다. vector/lexical/hydrate/rerank 단계 시간을 반환한다. 원문·임베딩·점수 공식은 변경하지 않았다.

검증: Node 21개 검사(기존 의미 모델 3개 + Worker 18개), 공식 MCP SDK 1.32.2의 Streamable HTTP 무인증 연결, 4개 기준 질의의 상위 5개 ID·순위·점수·청크 경계 동일성, 인용 본문 구간의 원문 일치, search/fetch 출력 스키마, 캐시 필터 분리. 로컬 기준선의 자산 읽기는 80→49, 72→36, 215→102, 64→38회. 로컬 처리 시간은 시스템 부하에 따라 변하며 실서버 기록과 구분한다. 별도 모델 API 호출을 하지 않았다.

남은 범위: 미추출 PDF·구형 HWP와 부서별 산발 자료, 자동 동기화, 독립된 사람 정답셋 기반 정확도 평가, 장기 부하 검증. 공개 MCP 배포가 ChatGPT 공개 플러그인 디렉터리의 심사·게시 완료를 의미하지 않는다.


## 기본 조회 및 예산 분류 (2026-11-08)

연도 미지정은 **2026년**입니다. 명시 연도를 우선하고 전체 연도는 `year_scope=all`로 조회합니다. 사업별 답변에는 담당 부서·정책사업·단위사업·세부사업·편성목·통계목을 기본 표시하며 미확인 값은 추정하지 않습니다. [조회 정책](QUERY_POLICY.md)과 [사례 검토](MCP_DESIGN_REVIEW.md)에 세부 규칙이 있습니다.
