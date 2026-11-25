# 패널 높이에 따라 늘리기 Implementation Plan

> 실행: Native(이 세션에서 직접 구현, 끝에 새 검토자 1명). 지난 계획과 같은 방식. 화면 확인은 사용자가 캡처로 한다.

## Context

짧게 보기는 끝난 단계 1개, 예정 3개(+마지막 단계)로 고정되어 있다. `FITS`(hooks/register.tsx:224-234)는 패널이 낮을 때 줄이기만 하고, 높이에 여유가 있어도 더 보여 주지 않는다. 사용자가 고른 것(2026-11-25):
- 자리가 남으면 **예정부터** 앞에서 하나씩 늘리고, 예정을 다 보인 뒤에도 남으면 **끝난 단계를 최근에 끝난 것부터** 늘린다.
- 명령 줄(▶ …)이 생겼다 없어질 때 목록이 들락날락하지 않게, 늘린 모양을 고를 때 **명령 줄 2줄 자리를 비워 둔다**.

**Goal:** 패널 높이에 맞춰 예정 → 끝난 단계 차례로 더 보여 주되, 스크롤과 깜빡임이 없게 한다.

**Architecture:** `hooks/register.tsx`만 고친다. `Fit.recent: boolean`을 `Fit.done: number`로 바꾸고, `FITS` 앞에 늘린 모양을 붙이는 `fitsFor()`를 더한다. 고르는 방식(넉넉한 것부터 그려 보고 들어가는 첫 모양)은 그대로 쓰되, 맞는 모양을 찾으면 멈추고, 늘린 모양은 명령 줄을 `max(2, 실제)`로 센다. `compact()`·`slots()`의 개수/이름 규칙(lone, end, 묶음)은 그대로 둔다.

**Tech Stack:** Claude Code mod(TypeScript/TSX), 테스트 `claude-code/testing`.

**Spec:** `docs/superpowers/specs/2026-11-25-grow-with-pane-design.md` (Task 0에서 이 계획의 Context·Global Constraints·테스트를 옮겨 쓴다)

## 실행 환경

- 작업 폴더: `C:\Users\MOONSEUNGGI\Desktop\workspace\cc-progress-panel`, 브랜치 `feature/grow-with-pane`(develop에서 땀)
- 빠른 테스트: `claude plugin test .` (지금 122개, 약 11초)
- 타입 검사: `scratchpad/tscheck/tsconfig.json`에서 `bunx --package typescript tsc -p tsconfig.json`. 테스트 파일의 원래 오류 4건만 남아야 한다(scratchpad가 지워졌으면 지난 방식대로 다시 만든다).
- 검증: `claude plugin validate .` (원래 경고만)
- 느린 테스트·LLM 테스트·서버: 없음
- 화면 확인: `hooks/register.tsx`, `types/index.d.ts`, `README.md`, `tests/progress.test.tsx`를 `~/.claude/mods/progress-panel/`에 복사하고 다음 턴에 시나리오를 띄워 사용자가 캡처한다.

## Global Constraints

- 스크롤이 생기지 않는다: 고른 모양의 실제 줄 수는 언제나 `bodyRows` 이하이거나, 가장 짧은 모양이다.
- 늘리는 차례: 예정(목록 차례로 하나씩, 전부까지) → 끝난 단계(끝난 시각이 늦은 것부터, 같으면 목록에서 뒤의 것부터, 전부까지). 같은 시각 규칙은 지금 `compact()`의 `last`(register.tsx:286)와 같다.
- 늘린 모양만 명령 줄을 `Math.max(CALL_ROOM, 실제 명령 줄)`로 센다. `CALL_ROOM = 2`. 기존 8개 모양(FITS)은 지금처럼 실제 줄로 센다.
- 진행 중·막힘은 늘 보인다. 마지막 단계 규칙(end), 혼자 숨는 단계 규칙(lone), 묶음 규칙은 바꾸지 않는다.
- 줄 수는 넉넉한 모양에서 짧은 모양 차례로 늘 줄지 않는다(숨은 끝남이 그린 묶음 안에 있으면 더 넉넉한 모양이 1줄 짧다). 그래서 이분 탐색이나 아래서 올라가는 지름길을 쓰지 않고, 위에서부터 차례로 잰다.

## Review Focus

1. 숨은 끝남이 그린 묶음 안에 있어 더 넉넉한 모양이 더 짧다 → 위에서부터 재므로 늘린 모양이 맞게 골라진다. → Task 1의 'a lone hidden step at the end of the last group…' 둘째 장면
2. 모두 끝난 목록 → 높은 패널에서는 끝난 단계가 모두 보인다. → Task 1의 'the rail is green…' 고친 기대
3. 명령이 3줄 이상 → 늘린 모양에서 빠지고, 기존 모양으로 넘치지 않게 그린다. → Task 1 새 테스트 'more than two command lines…'
4. 늘어난 예정이 그리지 않던 묶음에 닿으면 머리 줄까지 한 번에 여러 줄이 는다 → 그린 줄로 세므로 넘치지 않는다. → 기존 묶음 테스트(높이 고정 후)가 지나야 한다
5. 100단계 목록이면 모양이 100개쯤이다 → 맞는 모양에서 멈추므로 기존 100단계 테스트가 지금처럼 지난다. → 기존 테스트

---

### Task 0: 설계·계획 커밋 (develop)

- 예상 시간: 5분 · 기대는 Task: 없음 · 승인 지점: 없음 · 상태: 대기

- [ ] 설계 문서 `docs/superpowers/specs/2026-11-25-grow-with-pane-design.md`와 이 계획(`PLAN.md`)을 develop에 커밋·push. develop에서 `feature/grow-with-pane`을 딴다.

### Task 1: 높이에 따라 예정 → 끝난 단계 늘리기

- 예상 시간: 50분 · 기대는 Task: 0 · 승인 지점: 없음 · 상태: 대기
- Files: `hooks/register.tsx` (`Fit`·`FITS` 220-234, `compact()` 281-314, Pane의 모양 고르기 1176-1178), `README.md` 29-35, `tests/progress.test.tsx`

**Interfaces:**
- `type Fit = { todo: number; done: number; gaps: boolean; end: boolean; one?: boolean; grow?: boolean }` — FITS의 `recent: true/false`는 `done: 1/0`. `grow`는 늘린 모양 표시(명령 줄 자리 셈에만 쓴다).
- `function fitsFor(todoN: number, doneN: number): Fit[]` — 넉넉한 것부터 `(T,D) (T,D-1) … (T,2)`, 이어서 T가 3보다 크면 `(T,1) (T-1,1) … (4,1)`, 이어서 FITS. 늘린 모양은 모두 `gaps: true, end: true, grow: true`. T·D는 예정·끝난 잎 단계 수.
- `const CALL_ROOM = 2`

**테스트 목록** (모두 빠른 테스트). 새 테스트 공통 목록 `GROW`: 기획·조사·설계·시안(끝남, 1분 간격으로 이 차례로 끝냄), 개발(진행 중), 화면·서버·연결·시험·문서·배포·공개(예정 7개). 줄 수: 기본 18, 예정 4개 20, 예정 전부 22, +끝난 2개 24, 전부 26. 명령이 없으면 늘린 모양은 2줄이 더 있어야 고른다.

- [ ] **Step 1: 실패하는 새 테스트 작성**
  - `a taller pane shows more upcoming steps before more finished ones` (40×H, 터미널·데스크톱)
    - H=21 → `┆ 완료 3개 더`, `● 시안`, `◉ 개발`, `○ 화면`, `○ 서버`, `○ 연결`, `┆ 예정 3개 더`, `○ 공개` (늘린 모양은 22줄이 있어야 함)
    - H=22 → `┆ 완료 3개 더`, `● 시안`, `◉ 개발`, `○ 화면`, `○ 서버`, `○ 연결`, `○ 시험`, `┆ 예정 2개 더`, `○ 공개`
    - H=24 → `┆ 완료 3개 더`, `● 시안`, `◉ 개발`, 예정 7개 모두, 개수 줄 없음
    - H=26 → `┆ 완료 2개 더`, `● 설계`, `● 시안`, `◉ 개발`, 예정 7개 모두
    - H=28과 40 → 12단계 모두, `/개 더$/` 없음
  - `the finished steps added are the ones that ended last` — GROW에서 끝내는 차례만 시안 → 기획 → 설계 → 조사. H=26 → `┆ 완료 2개 더`, `● 조사`, `● 설계`, `◉ 개발`, 예정 7개 (기획·시안 없음)
  - `a running command does not change a grown pane` — GROW, H=22, `slow(on, w, 'Bash')`, `runBash`
    - 명령 1개 `테스트 실행` → H=22 첫 기대에서 `◉ 개발` 다음 줄에 `┆ ▶ 테스트 실행`, 나머지 같음
    - 명령 2개(`테스트 실행`, `타입 검사`) → 같은 모양에 ▶ 줄 2개
  - `more than two command lines shrink a grown pane instead of scrolling` — 같은 상태에서 명령 3개 → 기본 모양(`┆ 예정 3개 더`)에 ▶ 줄 3개
- [ ] **Step 2: 실패 확인** `claude plugin test .` → 새 테스트가 기본 모양(`┆ 예정 3개 더`)을 그려 실패
- [ ] **Step 3: 구현**
  - `Fit`·`FITS`를 위 Interfaces대로 바꾸고 `fitsFor()`, `CALL_ROOM`을 더한다. 주석 220-223을 새 규칙으로 고친다.
  - `compact()`: `last` 대신 끝난 단계를 `endedAt` 늦은 것부터(같거나 없으면 목록에서 뒤의 것부터) 정렬해 앞의 `fit.done`개를 `ids`에 넣는다. 나머지 규칙은 그대로.
  - 고르기: `callRows = (at ? callLines({ dot: 'subtle' }, hung).length : 0) + (bottom.length ? bottom.length + 1 : 0)`를 한 번 세고, `fitsFor(T, done)`을 차례로 `layout()`해 `rows + (fit.grow ? Math.max(0, CALL_ROOM - callRows) : 0) <= bodyRows`인 첫 모양에서 멈춘다. 없으면 마지막 모양.
- [ ] **Step 4: 새 테스트 통과, 깨지는 기존 테스트 손보기** — 기존 테스트 15개가 늘린 모양을 그려 깨진다(검토 에이전트 추정). 기대는 그대로 두고 패널 높이를 그 모양의 줄 수로 고정한다(주석에 줄 셈을 적는 기존 방식). 추정 높이:
  - 16: 'the finished step kept is the one that ended last…', 'a later step started first…', 'two places with hidden steps each get their own count'(16만 됨)
  - 14: 'a group with none of its steps shown is left out', 'a single hidden step with a note stays a count…'(두 장면), 'hidden steps before a group stay above it', 'a lone hidden step of a group not drawn stays a count'
  - 18: 'finished steps do not split a run of hidden steps', 'a lone finished step that would split the hidden steps…'
  - 13: 'a lone hidden step at the end of the last group takes the closing branch' — 그리고 둘째 장면으로 40줄에서 `● 준비`, `◉ 마무리`, `├─◉ g1`, `├─○ g2`~`├─○ g5`, `└─● g6`
  - 11: 'with the last group ahead…' · 10: 'hidden steps inside a group are counted between their neighbours' · 9: 'a group shows only the steps of it that are shown' · 8: 'a lone finished step of a group not drawn stays a count'
  - 'the rail is green…': `colors(rows = 40)` 인자를 더한다. 앞 두 상태는 그대로. 다 끝난 상태는 `colors()` → `['success','success','success','success']`(모두 보임), `colors(6)` → `['success']`이고 6줄에서 `┆`이 success.
  - 'a long list in a tall pane…' 주석(1180 근처)을 늘린 모양 기준으로 고친다.
  - 높이를 고정해도 기대가 안 맞는 테스트가 나오면 기대를 바꾸지 말고 멈춰 원인을 적는다.
- [ ] **Step 5: 전체 확인** `claude plugin test .` 실패 0개(122 + 새 4개), 타입 검사 원래 4건, `claude plugin validate .` 통과
- [ ] **Step 6: README** 29-35 짧게 보기: 기본(끝난 1개, 예정 3개)과, 높이에 여유가 있으면 예정 → 끝난 단계(최근 것부터) 차례로 더 보이고 명령 줄 2줄 자리를 비워 둔다는 것, 줄이는 차례는 그대로
- [ ] **Step 7: 커밋** `feat: 패널 높이에 여유가 있으면 예정, 끝난 단계 차례로 더 보임`

### Task 2: 화면 확인 (사용자 캡처)

- 예상 시간: 15분 · 기대는 Task: 1 · 승인 지점: **사용자가 캡처로 확인하기 전에는 병합하지 않는다** · 상태: 대기

- [ ] 4개 파일을 설치본에 복사하고 설치본에서 테스트. 다음 턴부터 시나리오를 띄우고, 사용자 패널 높이에서의 기대 모양을 미리 적어 준다.
  - A: GROW와 같은 12단계 목록 → 패널 높이만큼 예정이 늘고 아래 2줄이 빈다. 터미널을 줄이면 예정이 줄고 스크롤이 없다.
  - B: A 상태에서 명령(`claude plugin test .`, 약 11초) → ▶ 줄이 생겼다 없어져도 목록이 그대로다.
  - C: 모두 끝냄 → 끝난 단계가 모두 보인다.
- [ ] 끝나면 `clear`로 목록을 지운다.

### Task 3: develop 병합

- 예상 시간: 5분 · 기대는 Task: 2 · 승인 지점: 없음 · 상태: 대기

- [ ] 기능 브랜치에서 `git merge develop` 후 테스트 → develop에서 `git merge --no-ff feature/grow-with-pane` → 테스트, 비밀값 파일 점검 → push
- [ ] 이 계획을 `docs/plans/2026-11-25_높이에-따라-늘리기.md`로 옮기고 상태를 적어 develop에 커밋·push
- [ ] main 배포는 사용자가 지시할 때. 배포 뒤 설치본을 main 전체로 맞춘다(`git archive main | tar -x -C ~/.claude/mods/progress-panel`).

## Verification

- `claude plugin test .` 실패 0개(122 + 새 4개)
- 타입 검사 원래 4건만, `claude plugin validate .` 통과
- 사용자 캡처로 시나리오 A·B·C 확인
- 끝난 뒤 새 검토자 1명이 브랜치 전체를 본다
