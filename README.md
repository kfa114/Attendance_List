# 출석 — 프로그램 명단 관리

여러 교육 프로그램의 명단·서명·출결을 관리하는 반응형 웹앱입니다. **Cloudflare Workers + Static Assets + SQLite 기반 Durable Object**로 실행합니다. Google 계정·Apps Script·Sheets·Drive 연결이 필요하지 않습니다.

운영 주소: https://attendance-list.2022jjj.workers.dev . 배포는 GitHub 업데이트 후 CLI로 수동 진행합니다. 자동 배포 연결은 사용하지 않습니다.

## 구성

| 영역 | 구현 |
|---|---|
| 화면 | React 19, TypeScript, Vite, 파란색 포인트 반응형 UI |
| 서버 | Cloudflare Worker의 `/api`, 기존 공통 업무 서비스 재사용 |
| 저장 | Durable Object SQLite: 프로그램·명단·출결·서명 PNG·출력 스냅샷·세션 |
| 파일 가져오기 | XLSX / XLS / CSV / ODS, 필요할 때만 파서 다운로드 |
| PDF | 저장된 출력 스냅샷을 브라우저에서 jsPDF + 나눔고딕으로 생성 |
| 배포 | GitHub `kfa114/Attendance_List`에 푸시 후 Cloudflare CLI 수동 배포 |

R2·D1·KV·외부 유료 DB를 별도로 연결하지 않습니다. SQLite 기반 Durable Objects는 Workers Free에서 지원되지만 무료 사용량·저장량 제한을 받습니다. 무료 무제한 서비스를 의미하지 않습니다.

- [Workers 무료 요금·제한](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects 무료 요금·제한](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [SQLite 저장소 제한](https://developers.cloudflare.com/durable-objects/platform/limits/)

## 로컬 실행

Node.js 22 이상과 npm을 사용합니다.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev:cloudflare
```

Wrangler가 표시한 주소(기본 `http://localhost:8787`)로 접속합니다. 예제의 개발용 암호는 `local-preview-admin`이며 운영 암호로 사용하지 않습니다. 로컬에서만 ‘미리보기 시작’ 버튼을 표시합니다.

- Cloudflare 로컬 데이터: `.wrangler/state/`의 SQLite. 재시작 후에도 유지됩니다.
- `.dev.vars`는 Git에서 제외됩니다. 운영 암호를 이 파일이나 저장소에 올리지 않습니다.
- 기존 Node 개발 미리보기는 `npm run dev`로 실행할 수 있습니다. 이 방식은 `.local/`에 저장하며 Cloudflare 로컬 저장소와 다릅니다. Cloudflare 통합 확인에는 `dev:cloudflare`를 사용합니다.
- 운영 데이터·이전 Google 데이터·기존 `.local` 데이터가 자동 복사되지 않습니다.

## Cloudflare 배포

### GitHub 연결 — 추후 자동 배포를 선택할 경우

1. Cloudflare에서 **Workers & Pages → Create application → Git 저장소 연결**을 엽니다.
2. GitHub의 `kfa114/Attendance_List`만 선택해 연결합니다.
3. **Worker 이름:** `attendance-list` (`wrangler.jsonc`의 이름과 일치).
4. **운영 브랜치:** `main`, **루트:** 저장소 루트.
5. **빌드 명령:** `npm run build`, **배포 명령:** `npx wrangler deploy`.
6. Worker의 **Settings → Variables and Secrets**에서 `ADMIN_PASSPHRASE`를 **Secret**으로 추가합니다. 새 관리자 암호를 16자 이상으로 직접 설정합니다. GitHub·빌드 출력·일반 환경 변수에 암호를 넣지 않습니다.
7. 필요 시 새 버전을 배포한 뒤 제공된 `https://attendance-list.<계정>.workers.dev` 주소를 엽니다.
8. 관리자 로그인 → 가상 명단 생성 → 다른 기기의 태블릿 전용 링크 → 서명 저장 → PDF 다운로드를 확인한 뒤 운영합니다.

처음 배포할 때 `AttendanceWorkspace` SQLite Durable Object가 설정에 따라 만들어집니다. DB ID나 버킷을 수동으로 발급할 필요는 없습니다. 기존 Cloudflare 프로젝트는 변경하지 않으며 별도 Worker로 관리합니다. `ADMIN_PASSPHRASE`가 없거나 16자 미만이면 로그인 API가 운영자 설정 안내를 반환합니다.

Git 연동 후에는 `main` 변경을 푸시하면 자동 빌드·배포할 수 있습니다. 기존 데이터 유지를 위해 `AttendanceWorkspace` 클래스 이름, namespace binding 및 `attendance-workspace-v1` 객체 이름을 임의로 바꾸지 않습니다.

### CLI 배포

```sh
npx wrangler login
npm run deploy:check
npx wrangler secret put ADMIN_PASSPHRASE
npm run deploy
```

Cloudflare 로그인·계정 선택·권한 승인은 운영자가 진행합니다. `wrangler secret put`이 처음 프로젝트를 만들도록 요구하면 Worker를 먼저 생성·배포하고 Secret을 등록합니다. 암호가 없는 동안 API는 사용되지 않습니다.

## 기능과 운영 규칙

- 첫 페이지: 명단 생성, 검색·정렬, 카드/목록 보기, 보관·운영 재개·삭제·휴지통 복원.
- 프로그램별 교육생 / 태블릿 / 강사·관리자 탭.
- 순번·이름·연락처·비고의 4개 열. 제목은 직접 입력하거나 파일 상단에서 자동 인식하고 수정합니다.
- 파일 기준: 5MB, 시트당 2,000행·100열, 프로그램당 참여자 500명, 교육일 150일.
- 오전·오후 구분 사용 시 각각 서명. 끄면 교육일마다 기본 서명 1회. 교육일 설정과 모든 역할 기능 유지.
- 한국 시간 기준 오전 13:00 / 오후·기본 서명 18:00 마감. 미서명은 강사가 출석·결석 판단합니다.
- 출석률은 마감된 현재 서명 방식의 본인 서명만 집계합니다. 강사 판단은 미반영. 방식 변경은 기존 기록을 변환·삭제하지 않습니다.
- 교육일 달력의 날짜를 누르면 즉시 추가됩니다. 선택한 날짜는 하단 칩에서 제거합니다.
- 교육생은 연락처 뒤 4자리로 본인 조회, 중복 시 해당 번호의 이름·순번 목록에서 본인 선택. 교육생·태블릿에 연락처와 비고를 공개하지 않습니다.
- 태블릿에서 선택한 교육일·시간의 휴대폰 서명 QR을 생성합니다. QR 접속 → 큰 이름 목록(32px) → 본인 선택 → 자필 서명 → 완료 안내. 검색도 지원합니다.
- QR은 별도 서명 전용 세션으로 연락처·관리자 기능 없이 지정된 프로그램·날짜·시간만 허용합니다. 최대 6시간, 발급한 현장 세션의 만료를 넘지 않으며 교육일 마감을 적용합니다. QR을 본 사람은 이름을 선택할 수 있으므로 현장 참여자에게만 표시합니다.
- 첫 교육일의 직접 서명은 자동 보관됩니다. 다음 교육일부터 같은 프로그램·참여자의 이전 직접 서명이 있으면 이름 선택 후 ‘저장된 서명 불러오기’로 오늘 출석에 반영할 수 있습니다. 오전·오후와 기본 서명을 지원하며 기존 마감 시간을 적용합니다.
- 강사·관리자의 참여자별 출결에서 완료 서명을 취소할 수 있습니다. 해당 날짜·시간의 서명과 기존 강사 판단을 초기화하고 취소 이력을 남깁니다. 취소된 요청의 재전송은 차단하며 원본 이미지와 이전 PDF 버전은 유지합니다. 새 PDF에는 취소된 서명이 반영되지 않습니다.
- QR 휴대폰 이름 목록은 번호를 표시하지 않고 이름 32px, 카드 최소 높이 72px로 표시합니다.
- 태블릿 직접 서명·완료자 숨김도 유지합니다. 관리자에게 연락 기록·출결 판단·이력 제공.
- 삭제는 휴지통 이동으로 기록을 보존합니다. 휴지통에서는 기존 링크와 상세·출력 접근을 차단하며 복원할 수 있습니다.
- PDF는 A4 세로, 가운데 제목과 회색 머리글, 순번·이름·서명·비고의 표로 출력합니다. 오전·오후 사용 시 서명을 두 열로 나누며 일반 명단은 30명씩 출력합니다. 긴 이름·비고는 줄바꿈하며 필요한 경우 다음 페이지로 이어집니다. 미서명 서명란은 비워두고 강사 판단은 비고에 표시합니다.
- 서명 PNG는 비공개 SQLite에 저장됩니다. 버전 생성 시 제목·이름·서명 파일 참조·출결 상태를 고정하고 다운로드할 때 한글·서명 이미지가 포함된 PDF를 브라우저에서 만듭니다.

## 유지보수와 보안

- `src/domain/`: 데이터·업무 규칙. `server/service.ts`: 공통 인증·명단·출결 처리.
- `server/cloudflare/`: HTTP 검증, SQLite 어댑터, 영구 세션·조회 제한. 저장소 변경은 이 계층에서 처리합니다.
- 동일 Durable Object에서 동기 트랜잭션으로 명단 수정·중복 서명·서명 이미지 쓰기를 보호합니다.
- SQL 파라미터 바인딩을 사용하고 명단·파일을 공개 URL로 제공하지 않습니다. `/api`는 같은 출처의 JSON 요청만 받습니다.
- 관리자 4시간, 교육생 4시간, 태블릿 6시간 세션. 틀린 조회 5회 후 발신자별 15분 제한. 관리자 암호를 변경해도 이미 발급한 세션은 만료까지 유지되므로 노출 사고 시 세션 테이블도 폐기해야 합니다.
- 현재는 개별 강사 계정 대신 공동 관리자 암호를 사용합니다. 권한 위임·자동 백업·오프라인 저장 기능은 없습니다.
- 소규모 운영용 단일 SQLite 저장소입니다. 무료 저장 한도와 요청량을 Cloudflare 대시보드에서 확인하세요. 조회 시 프로그램별 레코드를 읽으며 대규모 통계용 구조가 아닙니다.
- 한 번의 PDF 다운로드 데이터는 12MB까지입니다. 원본 서명 이미지는 장당 750KB 이하입니다. 실제 서명 크기와 동시 접속 기기로 현장 검증이 필요합니다.

## 검증

```sh
npm test
npm run test:cloudflare
npm run build
npx wrangler deploy --dry-run
```

실제 로컬 Workers 통합 검사는 `dev:cloudflare`가 켜진 상태에서 실행합니다.

```sh
node scripts/test-cloudflare.mjs
```

이 스크립트는 localhost만 허용하고 가상 명단을 만든 뒤 휴지통으로 옮깁니다. SQLite 어댑터 검사는 Node 22의 `--experimental-sqlite`를 사용합니다.

이전 Apps Script 어댑터와 `build:gas`는 과거 버전 참고용으로 보존되어 있으나 기본 빌드·Cloudflare 운영에는 포함하지 않습니다. 앞으로의 운영 기준은 이 README와 `docs/Cloudflare_이전_검증.md`입니다.
