# Cloudflare 이전 검증 — 2026-10-20

## 구성 변경

Google 배포 흐름을 중단하고 Cloudflare 계정 안에서 화면·서버·저장소를 함께 운영하도록 이전했다. 기존 화면과 공통 서비스는 재사용한다. R2 추가 서비스 없이 SQLite 기반 Durable Object에 명단과 이미지·출력 데이터를 저장한다.

- `wrangler.jsonc`: Static Assets, API Worker, SQLite Durable Object 생성 설정.
- `server/cloudflare/index.ts`: 요청·출처·용량 검증, Secret 검증, 단일 저장소 라우팅.
- `server/cloudflare/storage.ts`: 기존 Repository/Runtime 구현, 영구 세션·시도 제한·이미지·출력 스냅샷.
- 파일 파서: Vite 동적 모듈로 배포. `/src/` 개발 경로와 Google 스크립트 다운로드에 의존하지 않음.
- PDF: 브라우저 jsPDF와 공개 라이선스 나눔고딕. 버전 생성 때 기록을 고정하고 다운로드 때 서명 이미지와 합성.
- 이전 로컬/Google 데이터는 복사하거나 삭제하지 않음. 운영 Secret도 재사용하거나 읽지 않음.

## 확인한 내용

- 기존 업무 규칙·파일 파싱 테스트와 한글 PDF 생성/500명 페이지 분할 검사 통과.
- SQLite 테스트: 프로그램 범위, 다중 쓰기·이미지 롤백, 중첩 트랜잭션 보호, 세션 재생성·만료, 발신자별 조회 제한, 보관/휴지통/복원, 서명 이미지 출력 스냅샷.
- Wrangler dry-run: 설정·정적 파일·namespace binding 통과. 실제 계정 업로드는 아님.
- 실제 Wrangler 로컬 서버: 인증, 프로그램 생성·저장, 교육생 범위, 태블릿 링크, 출력 스냅샷, 보관/휴지통/복원, JSON·출처 검증.
- 브라우저에서 샘플 XLSX 업로드 → 상단 제목 자동 인식 → 2명 명단 저장 → 기본 서명 캔버스 입력·저장 → 완료자 숨김 → 출력 버전 생성·실제 PDF 다운로드 확인.
- PDF 다운로드 후 PNG로 렌더링해 한글·표·서명 이미지 배치 확인. 헤더 칸의 채움색 문제는 수정하고 다시 검증.

## 남은 계정 작업

Cloudflare 로그인, 해당 GitHub 저장소만 연결하는 권한 승인, 별도 Worker 생성과 Secret 등록, 운영 URL에서 로그인·다른 기기 서명·PDF 재검증. 기존 Cloudflare 프로젝트와 Google 배포는 변경하지 않았다.

## 운영 한계

무료 요금제도 사용량 한도가 있다. 단일 Durable Object SQLite의 무료 저장 한도는 Cloudflare의 현재 정책에 따른다. 서명·출력 스냅샷이 누적되며 휴지통은 공간을 지우지 않는다. 영구 삭제·백업 UI는 후속 범위다. PDF 1회 응답은 12MB로 제한하며 큰 원본 이미지가 많이 쌓이면 제한에 걸릴 수 있다.
