# 검토에서 남긴 4건 정리 Implementation Plan

> 실행: autocontinue로 돌릴 때는 그 진행 방식을 따른다. 이 세션에서는 Native(직접 구현, 끝에 전체 검토 1번)를 권장한다. Task가 서로 거의 독립이고 작으며, 화면 확인을 사용자가 캡처로 하기 때문이다.

**Goal:** 공개 배포 전 검토에서 남긴 4건 가운데 3건을 고친다. `예정 n개 더`를 숨은 자리마다 적고, 숫자 뒤 원문자 사이에 쉼표를 넣고, 뜻 없는 검색 경로를 없는 것으로 본다. 기호 폭은 고치지 않는다.

**Architecture:** 한 파일 모드(`hooks/register.tsx`)를 고친다. 개수 줄은 새 함수 `slots()`가 "보이는 단계·묶음·숨은 덩어리"의 차례를 만들고, `compact()`의 1개짜리 규칙과 `layout()`의 그리기가 함께 쓴다. 나머지 둘은 `plain()`과 `labelOf()` 안의 경로 처리를 고친다.

**Tech Stack:** Claude Code mod(TypeScript/TSX, `claude-code` API), 테스트 `claude-code/testing`.

**Spec:** `docs/superpowers/specs/2026-11-25-review-leftovers-design.md` (사용자 승인 2026-11-25)

## Context

2026-11-25 공개 배포(main `4c14c45`) 전 `/code-review high develop`이 6건을 지적했다. 2건은 그때 고쳤고 4건은 남겼다. 사용자와 의논해 이렇게 정했다.

- `예정 n개 더`: A안. 숨은 덩어리마다 그 자리에 적는다.
- 1개짜리 덩어리: 맨 위 단계이고 메모가 없으면 개수 대신 그 단계를 그린다(제안, 승인).
- 기호 폭: 고치지 않는다.
- 원문자: 숫자 뒤면 쉼표를 넣는다.
- 경로: `.` `..` `~` `C:`는 없는 것으로 본다.

지금 화면에서 바뀌는 곳은 하나다. 묶음 앞뒤로 숨은 단계가 나뉘면 개수 줄도 둘로 나뉜다. 예: `┆ 예정 5개 더` 하나 → 묶음 위 `┆ 예정 4개 더` + 묶음 안 `│ ┆ 예정 1개 더`.

## 실행 환경

- 작업 폴더: `C:\Users\MOONSEUNGGI\Desktop\workspace\cc-progress-panel`
- 브랜치: `feature/review-leftovers`(develop에서 땀). 계획 문서는 develop에서만 고친다.
- 빠른 테스트: `claude plugin test .`
  - 지금 105개, 약 10초 걸린다.
  - 테스트마다 5초 제한이 있다. 부하로 관계없는 테스트가 시간 초과로 실패하면 같은 코드로 다시 돌린다.
- 타입 검사: `scratchpad/tscheck/tsconfig.json`(설치본 타입을 쓴다)에서 `bunx --package typescript tsc -p tsconfig.json`. 테스트 파일의 원래 오류 4건(TS2345 3건, TS2344 1건)만 남아야 한다.
- 검증: `claude plugin validate .`. version 없음·아이콘 없음 경고는 원래 있다.
- 느린 테스트·LLM 테스트: 없음
- 서버·컨테이너: 없음
- 화면 확인: 4개 파일(`hooks/register.tsx`, `types/index.d.ts`, `README.md`, `tests/progress.test.tsx`)을 설치본 `~/.claude/mods/progress-panel/`에 복사한다. 설치본은 `CLAUDE_CODE_PLUGIN_DIRS`로 읽히고, 답이 끝난 뒤 다시 읽힌다. 다음 턴에 시나리오를 띄우고 사용자가 캡처한다.
- 셸로 파일을 고칠 때 주의: 명령에 쓴 `\uXXXX`가 실제 글자로 바뀌어 들어간다. Edit 도구를 쓰거나, Python에서 `chr(92)`로 백슬래시를 만든다.

## Global Constraints

- 표시 문구: 맨 위 `┆ 예정 n개 더`, 묶음 안 `│ ┆ 예정 n개 더`(마지막 묶음의 맨 끝이면 `  ┆ 예정 n개 더`). 흐린 글씨(`dimColor`)는 지금과 같다.
- `완료 n개 더`의 자리(맨 위)와 동작은 바꾸지 않는다.
- 패널 높이 맞추기(`FITS`를 차례로 시도하고 그린 줄 수로 세기)는 그대로 둔다.
- 기존 테스트는 1835줄 'the final step stays in view even when it sits in a group'의 기대만 바꾸고(Task 1), 나머지는 그대로 통과해야 한다.

## Review Focus

1. 숨은 자리가 둘 이상이면 개수 줄 Box의 key가 서로 달라야 한다. 같으면 그리기가 거절된다. → Task 1 테스트 `two places`
2. 숨긴 끝난 단계가 숨긴 예정 사이에 있어도 덩어리를 끊지 않는다. 끝난 것은 맨 위 `완료 n개 더`에 들어간다. → Task 1 테스트 `finished steps do not split`
3. 좁은 패널에서 끝 단계가 빠지면 개수 줄이 마지막 묶음의 맨 끝에 온다. 이때 앞 단계는 `└─`, 개수 줄은 `  ┆ 예정 n개 더`로 세로선을 닫는다. → Task 1 테스트 `closes the rail`
4. `1①②`처럼 숫자 뒤에 원문자가 여럿 붙으면 `1,1,2`가 된다. → Task 2 테스트
5. 읽기 경로 `./notes.md`는 `notes.md`로 보인다(`.` 마디를 버린 결과). → Task 3 테스트

---

### Task 0: 계획 커밋 (develop)

- 예상 시간: 3분 · 기대는 Task: 없음 · 승인 지점: 없음 · 상태: 대기

- [ ] **Step 1:** 이 계획을 저장소 `PLAN.md`로 옮겨 적는다. 설계 문서(이미 써 둠, 아직 커밋 안 됨)와 함께 develop에 커밋하고 push한다.
  - 커밋 메시지: `docs: 검토에서 남긴 4건 설계와 계획`
- [ ] **Step 2:** develop에서 `feature/review-leftovers`를 딴다.

### Task 1: `예정 n개 더`를 숨은 자리마다

- 예상 시간: 40분 · 기대는 Task: 0 · 승인 지점: 없음 · 상태: 대기

**Files:**
- Modify: `hooks/register.tsx`
  - `compact()` 근처(236-257): `slots()`를 새로 만들고 `compact()`를 고친다.
  - Pane 그리기의 `layout`(약 1052-1110): `order`를 만들고 그리는 부분을 고친다.
- Modify: `README.md` "짧게 보기"의 예정 단계 설명
- Test: `tests/progress.test.tsx`

**Interfaces:**
- Produces (`hooks/register.tsx`):
  - `type KidSlot = { kind: 'step'; step: Step } | { kind: 'more'; steps: Step[] }`
  - `type Slot = { kind: 'step'; step: Step } | { kind: 'group'; step: Step; kids: KidSlot[] } | { kind: 'more'; steps: Step[] }`
  - `function slots(steps: Step[], ids: Set<string>): Slot[]`
  - `compact(ls, fit, steps)`는 `{ ids: Set<string>; moreDone: number }`를 돌려준다. `moreTodo`는 없앤다.

`slots()`의 차례(이 규칙이 설계의 핵심이다):

```
run = []                                          // 맨 위 목록의 숨긴 예정 덩어리
for s of steps:
  if s has children:
    if no child in ids: run += children with status 'todo'; continue   // 그리지 않는 묶음 → 맨 위 덩어리에
    flush(run); kids = []; inner = []
    for c of children:
      if c in ids: flushInner; kids.push({step c})
      else if c.status === 'todo': inner.push(c)  // 숨긴 끝남은 건너뜀(덩어리를 끊지 않음)
    flushInner; push {group s, kids}
  else if s in ids: flush(run); push {step s}
  else if s.status === 'todo': run.push(s)
flush(run)                                         // flush: 비어 있지 않으면 {more, steps} 하나
```

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 패널 크기는 `pane(surface, 40, 40)`, 차례는 `railRows(ui)`로 본다. 단계 이름은 아래에 적은 그대로 쓴다.
  - `a later step started first: the hidden steps are counted where they are`
    - 입력: 기획·조사·설계·시안 예정, 개발 진행 중, 검수·배포 준비 예정, 공개 예정(끝).
    - 기대: `○ 기획`, `○ 조사`, `○ 설계`, `○ 시안`, `^◉ 개발`, `┆ 예정 2개 더`, `○ 공개`.
  - `two places`
    - 입력: 위 목록에서 시안에 메모(`note: '확인 중'`, status todo)를 붙인다.
    - 기대: `○ 설계` 다음에 `┆ 예정 1개 더`, `^◉ 개발`, `┆ 예정 2개 더`, `○ 공개` 차례. 개수 줄 2개가 모두 그려진다.
  - `hidden steps before a group stay above it`
    - 입력: a~e 예정, 묶음 G[g1 진행 중, g2 예정].
    - 기대: `○ a`, `○ b`, `○ c`, `┆ 예정 2개 더`, `^◉ G`, `^├─◉ g1`, `└─○ g2`. 묶음 안에 개수 줄이 없다.
  - `a hidden step inside a group is counted between its neighbours`
    - 입력: 묶음 G[t1~t4 예정, t5 진행 중, t6 예정]만.
    - 기대: `^◉ G`, `├─○ t1`, `├─○ t2`, `├─○ t3`, `│ ┆ 예정 1개 더`, `^├─◉ t5`, `└─○ t6`.
  - `finished steps do not split a run of hidden steps`
    - 입력: 준비 끝남(나중에 끝남), 작성 진행 중, 표·그림·요약 예정, 부록 예정, 색인 끝남(먼저 끝남), 참고 예정, 인쇄 예정(끝).
    - 끝나는 차례: 색인을 먼저 끝내고 `w.clock.advance(1 * MIN)` 뒤 준비를 끝낸다.
    - 기대: `┆ 완료 1개 더`, `^● 준비`, `^◉ 작성`, `○ 표`, `○ 그림`, `○ 요약`, `┆ 예정 2개 더`, `○ 인쇄` 차례. 색인은 보이지 않는다.
    - 가장 최근에 끝난 단계는 보이므로 숨은 단계 사이에 두지 않는다. 보이면 덩어리를 끊는다.
  - `when the final step is dropped the count closes the rail of the last group`
    - 입력: 기존 `CHORES`, a 끝남, g1 진행 중, 패널 `pane(surface, 40, 8)`.
    - 이 높이에서는 `FITS[5]`(예정 0, 끝 단계 빼기)가 맞는다: 머리 3줄 + 5줄.
    - 숨긴 끝남이 준비 하나라 끝남 쪽 1개짜리 규칙으로 준비가 그려진다.
    - 기대: `^● 준비`, `^◉ 마무리`, `^└─◉ 청소`, `^  ┆ 예정 5개 더$` 차례.
  - 바꿀 기존 테스트: 'the final step stays in view even when it sits in a group'(높이 10).
    - 기대: `◉ 준비`, `┆ 예정 4개 더`, `발표`, `│ ┆ 예정 1개 더`, `└─○ 리허설`.
    - 주석의 줄 수를 `16, 14, 12, 10줄`로 고친다.
- [ ] **Step 2: 실패를 확인한다.** `claude plugin test .`를 돌린다.
  - 바꾼 테스트와 새 테스트 5개가 실패해야 한다.
  - `finished steps do not split…`은 지금 규칙으로도 결과가 같아 통과한다. 회귀를 막는 테스트다.
- [ ] **Step 3: `slots()`를 만든다.** 위 차례대로 구현한다.
- [ ] **Step 4: `compact()`를 고친다.**
  - 예정 쪽 1개짜리 규칙을 전체 개수 대신 덩어리마다 적용한다. `slots(steps, ids)`의 맨 위 `more` 가운데 `steps.length === 1`이고, 그 단계가 맨 위 단계(`top.has`)이며 메모가 없으면 `ids`에 넣는다.
  - 끝남 쪽 규칙은 그대로 둔다.
- [ ] **Step 5: `layout`을 고친다.**
  - `order`는 `slots(b.steps, ids)`로 만든다. 맨 위 `more`의 id는 차례대로 `more-todo-0`, `more-todo-1`…로 붙인다.
  - `inGroup`, `endShown`, `splice` 처리를 없앤다.
  - 묶음 안 `more`는 `leadOf({ rail, dot: 'subtle' })`와 흐린 `예정 n개 더`로 그린다.
  - 가지 `└─`는 마지막 묶음의 마지막 "단계" 칸에 준다. 그 뒤에 오는 `more`는 `rail: null`로 그린다.
  - 세로선 색(`open`, `railIn`, `railAfter`)은 지금 식을 그대로 쓴다.
- [ ] **Step 6: 테스트가 모두 통과하는지 확인한다.** `claude plugin test .` → 실패 0개(105 + 새 6개).
- [ ] **Step 7: README를 고친다.**
  - "숨긴 예정 단계는 있던 자리마다 `┆ 예정 n개 더`(묶음 안이면 `│ ┆ 예정 n개 더`)로 개수를 표시"로 바꾼다.
  - "마지막 단계가 묶음 안이고…" 줄은 이 규칙에 들어가므로 뺀다.
  - 1개짜리 규칙은 "숨은 자리의 단계가 1개이고 맨 위 단계이며 메모가 없으면 그 단계를 표시"로 바꾼다.
- [ ] **Step 8: 타입 검사와 커밋.** 타입 오류는 원래 4건만 남아야 한다.
  - 커밋 메시지: `feat: 숨긴 예정 단계를 있던 자리마다 개수로 표시`

### Task 2: 숫자 바로 뒤 원문자에 쉼표

- 예상 시간: 10분 · 기대는 Task: 0 · 승인 지점: 없음 · 상태: 대기

**Files:** Modify `hooks/register.tsx`의 `plain()`(약 296-316), `README.md` 원문자 줄 · Test `tests/progress.test.tsx`

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `a circled number right after a digit is set off with a comma`
  - 입력: 한 목록에 단계 4개, 모두 예정. 예정 3개와 끝 단계가 보이므로 모두 그려진다.
    - `Task 1①`, `그림 2③ 보기`, `Step①`, `1①② 비교`
  - 기대: `○ Task 1,1`, `○ 그림 2,3 보기`, `○ Step1`, `○ 1,1,2 비교`.
    - `1①②`는 보통 숫자로 시작하므로 맨 앞 번호 규칙(번호 글자 하나 + 빈칸)에 해당하지 않는다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: `plain()`을 고친다.** 지금 규칙(바꾼 번호끼리 이어지면 영숫자 사이에 쉼표)에 하나를 더한다. 바로 앞 글자가 바꾸지 않은 숫자(0-9)이고, 바꾼 결과가 숫자로 시작하면 쉼표를 넣는다. 영문자 뒤는 넣지 않는다.
- [ ] **Step 4: 통과를 확인한다.** README 원문자 줄에 `Task 1①` → `Task 1,1`을 더한다.
- [ ] **Step 5: 커밋.** `fix: 숫자 바로 뒤 원문자는 쉼표로 나눠 다른 수로 읽히지 않게`

### Task 3: 뜻 없는 검색·찾기 경로

- 예상 시간: 15분 · 기대는 Task: 0 · 승인 지점: 없음 · 상태: 대기

**Files:** Modify `hooks/register.tsx`의 `labelOf()` 안 `parts`·Grep·Glob(약 388-417), `README.md` 검색 줄 · Test `tests/progress.test.tsx`

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `a search over "." or a drive shows the glob instead, or nothing`
  - 형식은 기존 'a read shows its folder…' 테스트와 같다. `slow(on, w, 'Read'|'Grep'|'Glob')`, `w.clock.advance(2500)`, `^┆ ` 줄들을 본다.
  - 입력과 기대 결과:

    | 입력 | 기대 |
    |---|---|
    | Grep `{pattern:'foo', path:'.', glob:'*.ts'}` | `┆ ▶ 검색 "foo" · *.ts` |
    | Glob `{pattern:'**/*.tsx', path:'C:\\'}` | `┆ ▶ 찾기 **/*.tsx` |
    | Glob `{pattern:'*.md', path:'./web/.'}` | `┆ ▶ 찾기 *.md · web` |
    | Grep `{pattern:'bar', path:'~', type:'py'}` | `┆ ▶ 검색 "bar" · py` |
    | Read `{file_path:'./notes.md'}` | `┆ ▶ 읽기 notes.md` |

- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 경로 처리를 고친다.**
  - `parts()`는 `.` 마디를 버린다.
  - 새 지역 함수 `scope(key): string | undefined`는 마지막 마디를 돌려준다. 그 마디가 `..`, `~`, `/^[A-Za-z]:$/`이거나 마디가 없으면 `undefined`를 돌려준다.
  - Grep은 `scope('path') ?? (glob || type)`, Glob은 `where(scope('path') ?? '')`.
- [ ] **Step 4: 통과를 확인한다.** README 검색 줄에 "경로가 `.`·`~`·드라이브뿐이면 없는 것으로 봄"을 더한다.
- [ ] **Step 5: 커밋.** `fix: 검색 범위가 . ~ 드라이브뿐이면 glob·type을 보임`

### Task 4: 화면 확인 (사용자 캡처)

- 예상 시간: 10분(사용자 대기) · 기대는 Task: 1, 2, 3 · 승인 지점: **사용자가 캡처로 "괜찮다"고 하기 전에는 병합하지 않는다** · 상태: 대기

- [ ] **Step 1: 설치본에 복사한다.**
  - 복사 전 설치본이 develop과 같은지 `diff --strip-trailing-cr`로 본다.
  - 4개 파일을 복사하고, 설치본에서 `claude plugin test .`를 돌린다.
- [ ] **Step 2: 다음 턴에 시나리오를 띄운다.** 각 시나리오의 기대 모양을 미리 적어 준다.
  1. Task 1 첫 테스트 목록(개수 줄이 개발 아래에 하나, 시안은 이름으로 보임).
  2. 같은 목록에서 시안에 메모를 붙인 모양(개수 줄 둘).
  3. 묶음 G[t1~t4, t5 진행 중, t6] 목록(묶음 안 개수 줄).
  4. 원문자 목록(`Task 1,1`, `그림 2,3 보기`).
  5. 셸 명령이 아닌 검색을 실제로 1초 넘게 돌려 범위 줄을 보인다. 예: `path: '.'`, `glob: '*.md'`로 큰 폴더를 Grep. 1초 안에 끝나 보이지 않으면 이 시나리오는 테스트 결과로 갈음한다고 말한다.
- [ ] **Step 3: 확인이 끝나면 `clear`로 목록을 지운다.**

### Task 5: develop 병합과 계획 옮기기

- 예상 시간: 5분 · 기대는 Task: 4 · 승인 지점: 없음(Task 4 승인으로 갈음) · 상태: 대기

- [ ] **Step 1: develop 최신을 받는다.** 기능 브랜치에서 `git merge develop`을 하고 테스트를 돌린다. 충돌이 나면 `git merge --abort` 후 사용자에게 알린다.
- [ ] **Step 2: develop에 병합한다.** develop에서 `git merge --no-ff feature/review-leftovers`. 테스트를 다시 돌리고 push한다.
- [ ] **Step 3: 계획을 옮긴다.**
  - `PLAN.md`를 `docs/plans/2026-11-25_검토-남은-4건.md`로 옮기고, 상태 칸에 완료(커밋, 통과 수/전체)를 적는다.
  - develop에 커밋하고 push한다.
- [ ] **Step 4: 사용자에게 알린다.** main 배포는 사용자가 지시할 때 한다(develop → main 병합, push).

## Verification (끝에서 끝까지)

- `claude plugin test .`: 실패 0개(105 + 새 테스트 8개 안팎).
- 타입 검사: 테스트 파일의 원래 오류 4건만 남는다.
- `claude plugin validate .`: 통과(원래 경고만).
- 화면 확인: 사용자 캡처로 Task 4 시나리오 1~4를 확인한다. 5는 가능하면 확인한다.
- 끝난 뒤 전체 검토: 기능 브랜치 diff를 새 검토자 한 명이 본다(`/code-review` 또는 리뷰 에이전트). 지적은 고치거나 사유를 적어 남긴다.
