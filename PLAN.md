# 진행 패널 손질 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이 계획으로 패널을 다음처럼 바꾼다.
- 원문자 같은 글자가 겹치지 않는다.
- 끝 단계가 늘 보인다.
- 묶음 안 단계는 가지(`├─`)로 구분된다.
- 돌고 있는 명령은 어떤 파일·코드인지 한 호출 한 줄로 보인다.
- 지난 검토에서 미룬 문제 6건을 함께 고친다.

**Architecture:** 바뀌는 곳은 다음 세 곳이다. 상태 모양 태그는 올리지 않는다. 새 칸은 모두 없어도 되는 칸이다.
- `hooks/register.tsx`의 글자 폭 도우미(`plain`·`cells`·`cut`)
- 짧게 보기(`FITS`·`compact`)
- `labelOf`와 Pane 훅

**Tech Stack:** Claude Code mod(hooks module, TSX), `claude-code/testing`

**Spec:** 승인된 설계 `C:\Users\MOONSEUNGGI\.claude\plans\generic-kindling-willow-of-3e4a8e63-4717-4bfc-ba77-656c7b3c7f05.md`. 이 설계는 사용자 결정 2026-11-24와 스크린샷 `스크린샷 2026-11-24 143935.png`를 바탕으로 한다. 앞선 설계는 `docs/superpowers/specs/2026-11-24-panel-rail-design.md`다.

## 실행 환경

- 작업 폴더: `C:\Users\MOONSEUNGGI\Desktop\workspace\github\cc-progress-panel`
- 브랜치: `feature/panel-legibility`(develop에서 땀)
- 빠른 테스트: `claude plugin test .`
  - 지금 82개다.
  - 30초~4분이 걸린다. 기계 부하에 따라 다르다.
  - 테스트마다 5초 제한이 있다. 부하로 관계없는 테스트가 시간 초과로 실패하면 같은 코드로 다시 돌려 확인한다.
- 검증: `claude plugin validate .`. author·marketplace 설명 경고와 테스트 파일의 TS 오류 4건은 원래 있다.
- 느린 테스트·LLM 테스트: 없음
- 서버·컨테이너: 없음
- 화면 확인: `hooks/register.tsx`, `types/index.d.ts`, `README.md`, `tests/progress.test.tsx`를 설치본 `C:\Users\MOONSEUNGGI\.claude\mods\progress-panel\`에 복사한다.
- git
  - PowerShell에서 `git --no-pager …`로 쓴다. Bash에서 git은 멈춘다.
  - 커밋 메시지 파일은 Write 도구로 만든다. PowerShell `Set-Content`는 BOM을 붙인다.
  - push는 하지 않는다.

## Global Constraints

- 한 줄은 `e.props.bodyColumns`(최소 16)를 넘지 않는다. 한글·전각은 2칸, 이모지는 2칸이다(`cells`).
- 색은 테마 이름만 쓴다: `success`, `claude`, `warning`, `subtle`, `dimColor`.
- 표시 글자
  - 단계: `● ◉ ○ ▲ –`
  - 선: `│ ┆ ├ └ ─ ━`
  - 명령 글머리: `▶`
  - 이 밖의 새 기호는 쓰지 않는다. 사용자 터미널에서 바르게 보인 것만 쓴다.
- 보이는 글(단계 이름, 메모, 제목, 명령 줄, 알림)은 모두 `cut()`을 거친다. `cut()`은 `plain()`으로 원문자·로마 숫자를 보통 글자로 바꾼다.
- 시간 규칙과 알림 상자 모양은 바꾸지 않는다. 시간 규칙은 일한 시간, `방금 시작`, `n분째`다.
- 문구는 명사로 끝나는 개조식으로 쓴다.
- 스타일 테스트는 터미널·데스크톱(`SURFACES`) 둘 다에서 본다.

## Review Focus

1. 끝 단계가 묶음 안에 있을 때: 높이가 모자라도 묶음 이름과 그 단계가 함께 보이고, 줄 수 셈이 맞는다. → Task 2
2. 숨길 것이 1개인데 그 단계에 메모가 있거나 묶음 안이면: 개수 줄을 그대로 두어 줄 수가 늘지 않는다. → Task 2
3. 예전에 저장된 실행 중 항목(`kind: '파일 읽기'` 등)이 남아 있어도 줄이 깨지지 않는다. → Task 3
4. 백그라운드 명령만 있고 진행 중 단계가 있을 때: 맨 아래 칸에만 보이고 단계 아래에는 없다. → Task 4
5. 원문자 바꾸기가 한글(호환 자모 `ㅋ` 포함)과 다른 글자를 건드리지 않는다. → Task 1

---

### Task 1: 글자 폭과 머리 막대

**예상 시간:** 40분 · **선행 Task:** 없음 · **승인 지점:** 없음 · **상태:** 완료: e1a53ce, 87/87, feature/panel-legibility

**Files:**
- Modify: `hooks/register.tsx` (`cells`, `cut`, 새 `plain`, Pane 훅 머리 블록)
- Test: `tests/progress.test.tsx`

**Interfaces:**
- Produces:
  - `plain(text: string): string`
    - U+2460–24FF, U+2160–2188은 글자마다 NFKC로 바꾼다.
    - NFKC로 안 바뀌는 U+2776–2793, U+24EB–24FE는 코드 차이로 숫자를 만든다.
    - 바꾼 번호끼리 붙어 있으면 `,`로 나눈다.
    - `cut()` 맨 앞에서 부른다.
  - `cells(text)`: 이모지(`\p{Emoji_Presentation}`)는 2칸, U+FE0F·U+200D는 0칸으로 센다. `cut()`도 같은 폭으로 자른다.

- [ ] **Step 1: 실패하는 테스트**
  1. 이름 `넘겨주기(그림 ③)`인 단계 진행 중 → `/^◉ 넘겨주기\(그림 3\)/` 있음, `/③/` 없음
  2. 이름 `도구와 인자(그림 ④⑤)`, `Ⅳ장`, 메모 `❶ 확인`, 이름 `ㅋㅋ 메모` → `(그림 4,5)`, `IV장`, `┆ 1 확인`, `ㅋㅋ 메모` 그대로
  3. 이름에 `③`가 든 단계를 막힘으로 → 입력창 위 알림 글이 `/그림 3/`
  4. 이름 `배포 🚀` 진행 중, 40칸, 5분 뒤 → 그 줄 폭(이모지 2칸) = 40
  5. 16칸, 72분 진행 → 머리 둘째 줄 폭 ≤ 16, `/^─+ 0\/4$/`
  6. 100단계 목록, 40칸
     - 99개 끝남 → 막대에 `─` 1칸 이상
     - 1개 끝남 → `━` 1칸 이상
     - 지금은 반올림으로 각각 꽉 참과 0칸이 된다.
  - 테스트의 `cells` 도우미도 이모지를 2칸으로 세게 고친다.
- [ ] **Step 2: 실패 확인.** Run `claude plugin test .`. Expected: 위 6개 FAIL.
- [ ] **Step 3: 구현**
  - `plain`을 만들고 `cut`에서 부른다. `cells`에 이모지 폭을 넣는다.
  - 머리 줄
    - `cells(count)+cells(tail)+1 > cols`이면 tail을 뺀다.
    - 그래도 넘치면 `cut(count, cols)` 한다.
  - 막대 채움
    - 다 끝났으면 `barW`
    - 아니면 `min(barW-1, max(done?1:0, round(barW*done/total)))`
- [ ] **Step 4: 통과 확인.** Run `claude plugin test .`. Expected: 모두 PASS(88).
- [ ] **Step 5: 커밋.** `feat: 원문자·이모지 폭을 안전하게, 좁은 패널의 머리 막대`

### Task 2: 끝 단계를 늘 보이기

**예상 시간:** 50분 · **선행 Task:** Task 1 · **승인 지점:** 없음 · **상태:** 완료: 9624973, 90/90, feature/panel-legibility

**Files:**
- Modify: `hooks/register.tsx` (`Fit`, `FITS`, `compact`, Pane `layout`의 `more-todo` 자리)
- Test: `tests/progress.test.tsx`

**Interfaces:**
- `type Fit = { todo: number; recent: boolean; gaps: boolean; end: boolean }`
- `FITS`(7개)

  | 순서 | todo | recent | gaps | end |
  |---|---|---|---|---|
  | 1 | 3 | true | true | true |
  | 2 | 2 | true | true | true |
  | 3 | 1 | true | true | true |
  | 4 | 1 | false | true | true |
  | 5 | 0 | false | true | true |
  | 6 | 0 | false | true | false |
  | 7 | 0 | false | false | false |

- `compact(ls, fit, steps)`가 돌려주는 값은 그대로 `{ ids, moreDone, moreTodo }`다.
  - 끝 단계: `fit.end`이고 마지막 잎이 예정이면 넣는다.
  - 1개만 숨을 때: 숨는 끝남이나 예정이 딱 1개이고, 그 단계가 맨 위 단계이며 메모가 없으면 개수 대신 그 단계를 넣는다.
- `layout`: `more-todo` 줄은 끝 단계가 있는 블록 바로 앞에 둔다. 끝 단계가 없으면 맨 끝에 둔다.

- [ ] **Step 1: 테스트**
  - 아래 기대값으로 바꾸거나 더한다. 긴 목록은 `longUnderway`(s1·s2 끝남, s3 진행 중)이고, 모양별 줄 수는 18/16/14/12/10/8/6이다.

    | # | 상황 | 기대 |
    |---|---|---|
    | 7 | 높이 16 | `● 자료 수집`, `● 목차 구성`, `◉ 초안 작성`, `○ 그림 삽입`, `○ 맞춤법 검사`, `┆ 예정 2개 더`, `○ 게시` 차례로 |
    | 8 | 높이 40 | 8단계 모두, `/개 더$/` 줄 없음 |
    | 9 | 높이 13 | `┆ 완료 2개 더`, `◉ 초안 작성`, `○ 그림 삽입`, `┆ 예정 3개 더`, `○ 게시` |
    | 10 | 진행 중 2개, 높이 9 | 지금 기대 그대로 |
    | 11 | 마지막 잎이 묶음 안(`[a, b, c, d, e, 묶음 g[g1, g2]]`), a 진행 중, 높이 모자람 | `○ g`(묶음 이름)와 `└─○ g2` 보임, 패널 줄 수 ≤ 높이 |
    | RF2 | 숨는 예정 1개에 메모 | `┆ 예정 1개 더` 유지 |

  - 빵집 목록의 `┆ 예정 1개 더` 기대(공개하기 숨김)는 공개하기가 보이는 것으로 바꾼다.
- [ ] **Step 2: 실패 확인.** Expected: 새 기대 FAIL.
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인.** Expected: 모두 PASS.
- [ ] **Step 5: 커밋.** `feat: 끝 단계를 늘 보이고 하나만 숨을 땐 그 단계를 그림`

### Task 3: 가지와 명령 줄

**예상 시간:** 60분 · **선행 Task:** Task 2 · **승인 지점:** 없음 · **상태:** 완료: c8be339, 93/93, feature/panel-legibility

**Files:**
- Modify: `hooks/register.tsx` (`labelOf`, Pane `row`·`callLines`·`hang`·`leadOf`; `groupCalls`·`fitNames`·`CallGroup` 지움)
- Modify: `types/index.d.ts` (`Running.kind`·`target` 주석)
- Test: `tests/progress.test.tsx`

**Interfaces:**
- `labelOf(e): { label: string; kind?: string; target?: string }`
  - `label`은 종류와 대상을 이은 한 줄 글이다.

  | 도구 | 종류 | 대상 |
  |---|---|---|
  | Read | 읽기 | `폴더/파일`(경로 마지막 두 마디). offset이 있으면 `:시작`, limit도 있으면 `:시작-끝` |
  | Edit, NotebookEdit | 수정 | `폴더/파일` |
  | Write | 작성 | `폴더/파일` |
  | Grep | 검색 | `"패턴"`. path가 있으면 ` · 경로 끝 이름`, 없고 glob이 있으면 ` · glob`, 없고 type이 있으면 ` · type` |
  | Glob | 찾기 | `패턴`. path가 있으면 ` · 경로 끝 이름` |
  | WebSearch | 웹 검색 | `"검색어"` |
  | WebFetch | 웹 페이지 | 도메인 |
  | Agent | 에이전트 | 설명 |
  | Monitor | 모니터 | 설명 |
  | Skill | 스킬 | 이름 |
  | Bash, PowerShell, MCP | 없음 | 지금 그대로 |

- `fitTarget(kind: string, target: string, room: number): string`
  - 파일 종류(읽기·수정·작성)는 폴더를 빼고, 그다음 `:줄`을 빼고, 그다음 끝을 자른다.
  - 그 밖은 끝을 자른다.
- 명령 줄: `[앞부분]▶ [종류 흐리게] 대상`
  - `▶` 색은 앞 `┆` 색과 같다.
  - 같은 `label`은 한 줄로 합친다.
  - 최대 5줄이다. 넘치면 `[앞부분]외 n개`(흐리게).
- 묶음 안 단계 줄: `├─`(목록 맨 끝 묶음의 마지막 아래 단계만 `└─`) + 표시 + 이름
  - 가지 색은 `railIn(i)`다.
  - `└─` 아래 붙는 줄의 앞부분은 `  ┆ `다.

- [ ] **Step 1: 테스트**
  - 기존 테스트의 `│ ◉`·`│ ○`·`│ ●`는 `├─…`로 바꾼다.
  - `┆ 파일 읽기: …` 묶음 기대는 한 줄씩으로 바꾼다.
  - 세로선 색 테스트는 `/^│$/`와 `/^├─$/`를 함께 본다.
  - 아래를 더한다.

    | # | 상황 | 기대 |
    |---|---|---|
    | 12 | 빵집, b1 진행 중 | `/^├─◉ 메뉴 화면/`, `/^├─○ 주문 화면/` |
    | 13 | 묶음이 맨 끝(`[a, b[b1, b2]]`), b2 진행 중 + 메모 `확인` | `/^└─◉ b2/`, 다음 줄 `  ┆ 확인` |
    | 14 | Read `C:/Users/me/Proj/db/load.py` offset 120 limit 80 | `┆ ▶ 읽기 db/load.py:120-199` |
    | 15 | Grep `SESSION_RE` path `C:/Users/me/Proj/db` / Grep `x` glob `*.py` | `┆ ▶ 검색 "SESSION_RE" · db` / `┆ ▶ 검색 "x" · *.py` |
    | 16 | Read 5개 / 7개 동시 | 파일마다 `┆ ▶ 읽기 db/…` 5줄 / 5줄 + `┆ 외 2개` |
    | 17 | 24칸, b1 진행 중, Read `C:/a/very/long/folder/name/load.py` | `/^│ ┆ ▶ /` 줄 폭 ≤ 24, `load.py` 포함 |
    | 18 | Bash 설명 `테스트 실행`, a 진행 중 | `┆ ▶ 테스트 실행` |
    | RF3 | 저장된 실행 중 항목 `{label:'파일 읽기: x.py', kind:'파일 읽기', target:'x.py'}` | `┆ ▶ 파일 읽기 x.py`, 폭 안 |

  - 종류 글(`읽기`)이 흐리게(dimColor)인지, `▶` 색이 단계 색(진행 중 `claude`)인지를 두 화면에서 본다.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인.** Expected: 모두 PASS.
- [ ] **Step 5: 커밋.** `feat: 묶음 안 단계를 가지로, 명령을 한 줄씩 파일·검색 범위와 함께`

### Task 4: 명령이 붙는 자리와 테스트 빈틈

**예상 시간:** 40분 · **선행 Task:** Task 3 · **승인 지점:** 없음 · **상태:** 대기

**Files:**
- Modify: `hooks/register.tsx` (`buildSteps`, update의 doing 처리, `callsAt`, Pane의 명령 나누기, 주석 17·310줄 근처)
- Modify: `types/index.d.ts` (`Step.doingSince?: number`)
- Test: `tests/progress.test.tsx`

**Interfaces:**
- `Step.doingSince?: number`
  - 일한 시각으로 적는다.
  - update에서 doing이 될 때마다 적는다.
  - plan에서 doing인데 이전이 doing이 아니었을 때 적는다.
- `callsAt(ls)`: doing 잎 가운데 `doingSince ?? startedAt`이 가장 큰 것을 고른다.
- Pane
  - 보이는 명령 가운데 `isBackground`는 늘 맨 아래 `calls` Box에 간다.
  - 나머지만 `callsAt` 단계 아래에 간다. 그런 단계가 없으면 나머지도 맨 아래에 간다.

- [ ] **Step 1: 테스트**

  | # | 상황 | 기대 |
  |---|---|---|
  | 19 | a 진행 중 → 1분 → a 막힘, b1 진행 중 → 1분 → a 진행 중, Bash `사진 압축` | `◉ 사진 모으기` 다음 줄이 `┆ ▶ 사진 압축` |
  | 20 | b1 진행 중 → 1분 → a 진행 중, Bash | a 아래 `┆ ▶ 테스트 실행`, `/^│ ┆ ▶/` 없음 |
  | 21 | a 진행 중, 백그라운드 Bash `서버 실행`(taskId) + 보통 Bash `테스트 실행` | Box `calls` 안에 `┆ ▶ 서버 실행`, a 아래에 `┆ ▶ 테스트 실행`, a 아래에 `서버 실행` 없음 |
  | 22 | 세로선 색·붙는 점선 색 테스트 | `SURFACES` 두 화면에서 같은 색 |

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현.** 주석의 "실행 중 칸"을 "돌고 있는 명령"으로 고친다.
- [ ] **Step 4: 통과 확인.** Expected: 모두 PASS.
- [ ] **Step 5: 커밋.** `feat: 다시 시작한 단계에 명령을 붙이고 백그라운드는 맨 아래로`

### Task 5: 설명서, 설치본, 화면 확인, develop 병합

**예상 시간:** 15분 + 사용자 확인 · **선행 Task:** Task 4 · **승인 지점:** 실제 패널 화면 확인(사용자) · **상태:** 대기

- [ ] **Step 1: README.** 다음 내용을 반영한다.
  - 원문자는 보통 숫자로 바꿈
  - 끝 단계는 늘 보임
  - 묶음 안 단계는 `├─`
  - 명령은 `▶ 종류 대상` 한 줄씩
  - 백그라운드는 맨 아래
  - 커밋: `docs: README에 패널 손질 반영`
- [ ] **Step 2: 설치본에 4개 파일 복사.**
  - 복사 전 설치본이 develop과 같은지 본다.
  - 복사 뒤 설치본에서 `tsc`(기존 오류 2건만)와 `claude plugin test`를 돌린다.
- [ ] **Step 3: 사용자 화면 확인.** 원문자 든 단계 이름, 끝 단계, 묶음 가지, 여러 파일 읽기를 실제로 본다. "괜찮다" 전에는 병합하지 않는다.
- [ ] **Step 4: develop 병합.**
  1. `git merge develop`
  2. 테스트
  3. develop에서 `git merge --no-ff feature/panel-legibility`
- [ ] **Step 5: 계획 옮기기.** `PLAN.md` → `docs/plans/2026-11-24_진행-패널-손질.md`, develop에 커밋한다.
