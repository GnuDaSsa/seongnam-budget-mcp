# 통합 배포

승인된 수정은 검증 → 공공 GitLab → GitHub → 공개 사이트 → MCP 확인까지 하나의 작업으로 진행합니다. 사용자가 로컬 전용이나 게시 금지를 요청하면 해당 범위에서 멈춥니다.

기준 저장소는 `release.config.json`에 기록합니다. GitHub와 GitLab에는 같은 소스 커밋을 전송합니다. Sites는 검색 자산을 포함한 별도 이력을 유지하므로 Sites 소스 커밋은 다를 수 있으며, 빌드에 기록한 기준 소스 식별값으로 대응시킵니다.

## 실행 순서

1. 원격 변경과 작업 상태를 확인합니다. 충돌이나 다른 작업의 변경은 먼저 정리하고 강제로 덮어쓰지 않습니다.
2. `node scripts/release.mjs prepare --message "변경 내용"`으로 소스와 기존 검색 자산을 검증하고 테스트 후 커밋합니다. 자산이 없으면 임의로 전체 재수집을 시작하지 말고 기존 검증된 스냅샷을 준비합니다.
3. `node scripts/release.mjs push`로 공공 GitLab의 보안 검사를 먼저 통과한 뒤 GitHub에 동일 커밋을 보냅니다. 양쪽 원격 SHA를 확인합니다.
4. Sites 스킬에 따라 기존 사이트를 조회하고 단기 source credential을 발급받아 공식 helper로 checkout을 엽니다. 공개 audience를 유지합니다.
5. `node scripts/release.mjs sync-sites --checkout <공식 helper가 반환한 checkout 경로>`로 기준 소스를 반영합니다. Sites의 검색 자산과 별도 Git 이력을 보존합니다.
6. 공식 `site-workflow.mjs`에 credential과 opening result, 빌드 명령, archivePath를 stdin JSON으로 전달합니다. 반환된 `project_id`, `commit_sha`, `archive`를 그대로 사용합니다.
7. native `save_site_version` → `deploy_site_version`을 호출합니다. pending/building/publishing이면 같은 deployment를 조회하며, 성공 여부가 불확실한 상태에서 새 배포를 중복 생성하지 않습니다.
8. `node scripts/release.mjs verify --receipt .release-state/deployment-receipt.json --connections .release-state/connections.json`으로 운영 버전과 공개 MCP를 확인합니다. 공식 배포 성공 응답과 연결된 `성남 예산 아카이브`·`성남 예산 공개 MCP`의 실제 `get_collection_status` 응답에서 아래 검증 필드만 저장합니다. 연결 확인이 빠지면 완료 처리하지 않습니다.

명령의 현재 인자와 출력은 스크립트의 도움말을 확인합니다. `.release-state/`에는 진행 정보만 보관하며 토큰이나 인증 응답을 넣지 않습니다. 중간 실패 시 해당 커밋과 성공 단계를 유지한 채 재개합니다. 작업 소스가 바뀌면 새 검증이 필요합니다.

`deployment-receipt.json`은 공식 배포 응답의 다음 필드를 그대로 보관합니다. ID나 성공 상태를 임의로 만들지 않습니다.

```json
{
  "status": "succeeded",
  "project_id": "<공식 project_id>",
  "id": "<공식 deployment id>",
  "version_id": "<공식 version_id>",
  "url": "<공식 운영 URL>"
}
```

`connections.json`은 각 연결 도구가 반환한 `release` 객체와 연결 이름으로 구성합니다. 로컬 식별값을 복사해 도구 응답을 대신하지 않습니다.

```json
[
  {"name": "성남 예산 아카이브", "release": {"source_sha": "<응답 SHA>", "source_digest": "<응답 digest>", "verified_source": true}},
  {"name": "성남 예산 공개 MCP", "release": {"source_sha": "<응답 SHA>", "source_digest": "<응답 digest>", "verified_source": true}}
]
```

소스 삭제는 `prepare`의 검증·커밋 전에 명시적으로 거절합니다. 삭제가 필요한 변경은 Sites 잔존 파일까지 별도 검토해야 합니다. `sync-sites`는 첫 복사 전에 기준 저장소의 `.release-state/sites-sync.json`에 대상 checkout, HEAD, 소스 식별값과 파일별 변경 전후 해시를 기록합니다. 같은 명령을 다시 실행할 때 기록과 정확히 일치하는 변경 전/후 파일만 이어서 복사합니다. 다른 파일 변경, 알 수 없는 부분 복사, 사용자 수정 또는 손상된 기록은 보존하고 중단하며 자동 덮어쓰기나 복구를 하지 않습니다. 기록에는 자격증명이나 토큰을 넣지 않습니다.

## 완료 판단

- GitHub와 GitLab `main`이 동일한 기준 커밋입니다.
- Sites의 저장 버전과 운영 배포가 확인됐습니다.
- 운영 서버의 릴리스 식별값이 이번 기준 소스와 일치합니다.
- 공개 MCP에서 예산 원문과 통계목을 조회하는 검사가 통과했습니다.

완료 보고에는 두 저장소 커밋, 사이트 버전, MCP 확인 결과를 구분합니다. 테스트 통과만으로 배포 완료라고 말하지 않습니다. 일부 대상만 반영되면 그 상태를 명시합니다.

## 자동화 범위

이 절차는 Codex 수정 작업의 기본 완료 조건으로 `AGENTS.md`에 연결됩니다. 사용자가 매번 커밋·푸시·배포를 다시 지시할 필요가 없습니다. GitHub와 GitLab CI도 단위 검사를 수행하지만 CI 검사 성공 자체가 사이트 배포를 의미하지 않습니다.

현재 공개 ChatGPT Sites는 공식 source helper와 native 저장·게시 도구를 사용합니다. 확인된 `publish_on_push`는 소유자 전용 비공개 사이트의 한시적 기능이므로 이 공개 MCP에는 적용하지 않습니다. 공개 배포용 영구 CI 자격증명/API는 확인되지 않았으며, GitHub 외부 푸시만으로 무인 Sites 배포가 실행된다고 약속하지 않습니다.

기존 MCP는 같은 서버 주소를 계속 사용하므로 새 서버 동작을 받습니다. Sites가 만든 플러그인의 도구 목록은 재게시 때 갱신됩니다. 별도 사용자 지정 플러그인의 도구 이름·입력 형식을 변경했다면 해당 클라이언트의 재검색 지원을 확인합니다. 서버 업데이트 적용과 ChatGPT의 자동 도구 선택은 구분합니다.
