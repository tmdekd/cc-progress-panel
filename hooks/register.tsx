import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type { Alert, AlertKind, Board, BoardEntry, Running, Step, StepStatus } from '../types'

const PLUGIN = 'progress-panel'
const PANE = 'progress'
const TOOL = 'mcp__progress-panel__progress'
const OPEN = { id: PANE, title: '진행 상황', columns: 36 } as const

// 꺼진 창으로 보는 기준, 살아 있음 표시 주기, 저장해 둘 목록 수.
const ORPHAN_MS = 3 * 60_000
const BEAT_MS = 60_000
const KEEP = 30
// 1초보다 짧은 호출은 패널에 띄우지 않는다(깜빡임 방지).
const SHOW_AFTER_MS = 1000
// 돌고 있는 명령을 한 자리(진행 중 단계 아래, 목록 맨 아래)에 보이는 줄 수.
const MAX_CALLS = 5
// 머리 막대가 이보다 짧아지면 걸린 시간을 뺀다.
const MIN_BAR = 4
// 백그라운드 명령은 끝 알림을 놓쳐도 이 시간이 지나면 지운다.
const BACKGROUND_TTL_MS = 12 * 60 * 60_000
// 입력창 위 알림이 보이는 시간과 한 번에 쌓아 두는 줄 수.
const ALERT_MS = 5_000
const MAX_ALERTS = 4

// 모양 태그는 값의 필드가 바뀌면 올린다. 옛 모양으로 저장된 값은 초기값으로 읽힌다.
const board = atom({ plugin: 'progress-panel', key: 'board' } as const, null, { shape: 'board-1' })
const running = atom({ plugin: 'progress-panel', key: 'running' } as const, [], { shape: 'running-1' })
const alerts = atom({ plugin: 'progress-panel', key: 'alerts' } as const, [], { shape: 'alerts-1' })
const now = atom({ plugin: 'progress-panel', key: 'now' } as const, 0)
// $.state 의 목록이 어느 세션 것인지. 다시 불러온 것과 새 세션을 가른다.
const owner = atom({ plugin: 'progress-panel', key: 'owner' } as const, '')

// 다시 불러오면 처음으로 돌아가는 값들. session.start 가 다시 채운다.
let me: { root: string; sid: string } | undefined
let switching: Promise<void> | undefined
let ticker: { timer: Timer; ms: number } | undefined
let beat: Timer | undefined
let pendingNotice: string | undefined
let seq = 0
// 턴과 턴 사이(Claude가 쉬는 중)인지. 질문 창이 닫혀도 턴 사이면 시간을 다시 세지 않는다.
let between = false

// 이 도구가 도는 동안은 사용자의 답을 기다리는 것이라 시간을 세지 않는다.
const WAITING = new Set(['AskUserQuestion', 'ExitPlanMode'])

const STATUSES: readonly StepStatus[] = ['todo', 'doing', 'done', 'blocked', 'skipped']
// 진행선 모양의 표시(사용자가 고름, 2026-11-24).
const MARK: Record<StepStatus, string> = { todo: '○', doing: '◉', done: '●', blocked: '▲', skipped: '–' }
const COLOR: Record<StepStatus, Color> = {
  todo: 'subtle',
  doing: 'claude',
  done: 'success',
  blocked: 'warning',
  skipped: 'subtle',
}
// 이름: 진행 중·막힘은 굵게 색, 끝난 것은 흐리게, 건너뛴 것은 흐리게 줄 긋기.
type Style = { color?: Color; bold?: boolean; dimColor?: boolean; strikethrough?: boolean }
const LABEL: Record<StepStatus, Style> = {
  todo: {},
  doing: { color: 'claude', bold: true },
  done: { dimColor: true },
  blocked: { color: 'warning', bold: true },
  skipped: { dimColor: true, strikethrough: true },
}
const TIME: Record<StepStatus, Style> = {
  todo: { dimColor: true },
  doing: { color: 'claude' },
  done: { dimColor: true },
  blocked: { color: 'warning' },
  skipped: { dimColor: true },
}
// 입력창 위 알림: 끝은 초록, 막힘은 노랑. 상자 테두리는 막힘이 하나라도 있으면 노랑.
const ALERT_COLOR: Record<AlertKind, Color> = { done: 'success', blocked: 'warning', all: 'success' }

const RULES = {
  id: `${PLUGIN}:rules`,
  scope: 'session',
  text: [
    '# 진행 상황 패널 (progress-panel)',
    `화면 옆 "진행 상황" 패널은 \`${TOOL}\` 도구로 적고 고친다. 사용자는 이 패널 하나로 무엇을 할 예정이고, 지금 무엇을 하고 있고, 무엇이 끝났거나 막혔는지 본다. 패널이 늘 실제 진행과 맞도록 고친다.`,
    '- 언제: 여러 단계로 나뉘는 일이면 일의 종류와 상관없이 쓴다(개발, 문서 작성, 조사·분석, 설치·설정, 데이터 정리 등). 단계가 3개 이상인 일, 계획이나 체크리스트를 따라 하는 일, 사용자가 자리를 비운 동안 이어 가는 일은 크기와 상관없이 쓴다. 한두 단계로 끝나는 짧은 질문이나 작업에는 쓰지 않는다.',
    '- 일을 시작할 때 action "plan"으로 할 일 전체를 하는 순서대로 적는다. id는 짧은 영문·숫자, label은 사용자가 쓰는 언어로 무엇을 하는지 한눈에 알 수 있는 짧은 말. 묶음 아래에 단계가 있으면 children으로 한 층만 더 적는다. 따르는 계획이나 체크리스트가 있으면 그 항목 이름과 순서를 그대로 쓴다.',
    '- 단계를 시작하기 바로 전에 status "doing", 끝나면 바로 "done", 막히면 "blocked"(note에 이유 한 줄), 하지 않기로 하면 "skipped"로 action "update"를 부른다. 여러 단계를 나중에 몰아서 고치지 않는다. children이 있는 묶음의 상태는 패널이 아래 단계로 계산하므로 묶음은 update하지 않는다.',
    '- 하는 도중 할 일이 늘거나 바뀌면 같은 title로 다시 "plan"을 불러 목록을 맞춘다(같은 id 단계의 상태와 시간은 이어진다). 다른 일을 시작하면 새 title로 "plan"을 부른다.',
    '- 사용자 메시지에 "[진행 상황 패널]" 안내가 붙어 있으면 이 창이 이어받은 목록이 있다는 뜻이다. 지금 하려는 일과 같은 일이면 그 목록을 이어서 update하고, 다른 일이면 plan으로 새로 적는다. action "show"로 지금 목록을 볼 수 있다.',
    '- 다른 할 일 기록 도구를 함께 쓰고 있으면 그 기록도 평소대로 같은 때에 함께 고친다.',
    '- 패널의 진행 중 단계 아래에는 지금 돌고 있는 셸 명령(Bash·PowerShell)의 description이 그대로 보인다. description은 사용자가 쓰는 언어로, 무엇을 하는지 알 수 있게 짧게(15자 안팎) 적는다.',
    "- label과 description은 그 언어의 문법에 맞는 자연스러운 말로, 명사로 끝나는 짧은 개조식으로 적는다(예: '자료 수집', '초안 작성', '테스트 실행'. '~하기'·'~함'으로 끝내지 않는다). 두 가지 일을 한 줄에 이어 붙이지 않는다.",
    '- 메인 대화에서만 쓴다. 서브 에이전트는 쓰지 않는다.',
  ].join('\n'),
} as const

const SPEC = {
  name: 'progress',
  isDeferred: false,
  description: [
    '채팅 옆 "진행 상황" 패널의 단계 목록을 적고 고칩니다. 사용자는 이 패널로 할 예정인 일, 지금 하는 일, 끝났거나 막힌 일을 봅니다.',
    'action: "plan"(전체 목록을 새로 씀: title, steps[{id, label, status?, children?}]. 제목이 같으면 같은 id 단계의 상태·시간을 이어받고, 다르면 모두 새로 시작),',
    '"update"(id, status: todo|doing|done|blocked|skipped, note?), "show"(지금 목록), "clear"(목록 지우기).',
    '여러 단계로 나뉘는 일이면 종류와 상관없이(단계 3개 이상, 계획·체크리스트를 따르는 일, 자리를 비운 동안 이어 가는 일) 메인 대화에서만 씁니다. 결과로 지금 목록을 돌려줍니다.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['plan', 'update', 'show', 'clear'] },
      title: { type: 'string', description: 'plan: 패널 맨 위에 보일 작업 이름' },
      steps: {
        type: 'array',
        description: 'plan: 단계 목록. children은 한 층만',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            status: { type: 'string', enum: [...STATUSES] },
            children: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  status: { type: 'string', enum: [...STATUSES] },
                },
                required: ['id', 'label'],
              },
            },
          },
          required: ['id', 'label'],
        },
      },
      id: { type: 'string', description: 'update: 고칠 단계의 id' },
      status: { type: 'string', enum: [...STATUSES], description: 'update: 새 상태' },
      note: { type: 'string', description: 'update: 막힌 이유 등 한 줄' },
    },
    required: ['action'],
  },
} as const

// ── 계산 ──────────────────────────────────────────────

const isFinal = (s: StepStatus) => s === 'done' || s === 'skipped'
const isNow = (s: StepStatus) => s === 'doing' || s === 'blocked'

function leaves(steps: readonly Step[]): Step[] {
  return steps.flatMap(s => (s.children?.length ? leaves(s.children) : [s]))
}

function allFinal(b: Board): boolean {
  return leaves(b.steps).every(s => isFinal(s.status))
}

type Shown = { status: StepStatus; startedAt?: number; endedAt?: number }

// 묶음은 아래 단계로 상태와 시간을 정한다.
function shown(step: Step): Shown {
  const kids = step.children
  if (!kids?.length) return step
  const all = kids.map(shown)
  let status: StepStatus = 'todo'
  if (all.some(k => k.status === 'blocked')) status = 'blocked'
  else if (all.every(k => k.status === 'skipped')) status = 'skipped'
  else if (all.every(k => isFinal(k.status))) status = 'done'
  else if (all.some(k => k.status !== 'todo')) status = 'doing'
  const starts = all.flatMap(k => (k.startedAt === undefined ? [] : [k.startedAt]))
  const ends = all.flatMap(k => (k.endedAt === undefined ? [] : [k.endedAt]))
  return {
    status,
    startedAt: starts.length ? Math.min(...starts) : undefined,
    endedAt: isFinal(status) && ends.length ? Math.max(...ends) : undefined,
  }
}

function findStep(steps: Step[], id: string): Step | undefined {
  for (const s of steps) {
    if (s.id === id) return s
    const found = s.children ? findStep(s.children, id) : undefined
    if (found) return found
  }
  return undefined
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}초`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h}시간 ${rest}분` : `${h}시간`
}

function timeText(st: Shown, t: number): string {
  if (st.startedAt === undefined) return ''
  // 진행 중 시간은 30초마다만 다시 그려 1분 전까지는 숫자가 멈춰 보인다. 그동안은 "방금 시작"으로 적는다.
  if (st.status === 'doing') return t - st.startedAt < 60_000 ? '방금 시작' : `${fmt(t - st.startedAt)}째`
  if (st.endedAt !== undefined) return fmt(st.endedAt - st.startedAt)
  return ''
}

// 일한 시각: 벽시계에서 Claude가 쉰 시간을 뺀 것. 쉬는 동안에는 쉬기 시작한 때에 멈춰 있다.
// 단계 시각과 걸린 시간은 모두 이것으로 잰다(사용자 요청, 2026-11-19).
function workTime(b: Board | null, t: number): number {
  if (!b) return t
  return (b.pausedSince ?? t) - (b.paused ?? 0)
}

// 전체 걸린 시간: 가장 먼저 시작한 단계부터 지금까지. 다 끝났으면 마지막으로 끝난 때까지.
function totalTime(ls: Step[], t: number): string {
  const starts = ls.flatMap(s => (s.startedAt === undefined ? [] : [s.startedAt]))
  if (!starts.length) return ''
  const from = Math.min(...starts)
  if (!ls.every(s => isFinal(s.status))) return timeText({ status: 'doing', startedAt: from }, t)
  const ends = ls.flatMap(s => (s.endedAt === undefined ? [] : [s.endedAt]))
  return ends.length ? fmt(Math.max(...ends) - from) : ''
}

// 짧게 보기(사용자가 정함, 2026-11-19): 진행 중·막힘은 늘 모두, 끝난 것은 가장 최근에 끝난 1개,
// 예정은 앞에서 3개까지. 패널 높이에 안 들어가면 FITS 의 다음 모양으로 줄여 스크롤이 생기지 않게 한다.
// 끝 단계(2026-11-24): 마지막 단계가 예정이면 일이 어디서 끝나는지 보이게 늘 그린다(end). 거의 마지막 모양에서만 뺀다.
// 하나로(one, 2026-11-25): 숨긴 예정은 자리마다 개수를 적지만, 무엇으로도 모자라면 끝으로 개수 줄 하나로 합친다.
type Fit = { todo: number; recent: boolean; gaps: boolean; end: boolean; one?: boolean }
const FITS: readonly Fit[] = [
  { todo: 3, recent: true, gaps: true, end: true },
  { todo: 2, recent: true, gaps: true, end: true },
  { todo: 1, recent: true, gaps: true, end: true },
  { todo: 1, recent: false, gaps: true, end: true },
  { todo: 0, recent: false, gaps: true, end: true },
  { todo: 0, recent: false, gaps: true, end: false },
  { todo: 0, recent: false, gaps: false, end: false },
  { todo: 0, recent: false, gaps: false, end: false, one: true },
]
// 패널 머리: 제목 1줄 + 막대와 숫자 1줄 + 빈 줄 1줄.
const HEAD_ROWS = 3

// 그릴 차례: 보이는 단계·묶음, 그리고 숨긴 예정이 이어진 덩어리(more). 덩어리마다 그 자리에 개수를 적는다
// (사용자가 고름, 2026-11-25). 보이는 아래 단계가 없는 묶음은 그리지 않으므로 그 안의 숨긴 예정은 맨 위 덩어리에 든다.
// 숨긴 끝남은 맨 위 "완료 n개 더"에 들므로 덩어리를 끊지 않는다. one이면 숨긴 예정을 모두 맨 끝 덩어리 하나에 모은다.
type KidSlot = { kind: 'step'; step: Step } | { kind: 'more'; steps: Step[] }
type Slot = KidSlot | { kind: 'group'; step: Step; kids: KidSlot[] }

function slots(steps: readonly Step[], ids: Set<string>, one = false): Slot[] {
  const out: Slot[] = []
  let run: Step[] = []
  const flush = () => {
    if (run.length) out.push({ kind: 'more', steps: run })
    run = []
  }
  for (const s of steps) {
    const kids = s.children ?? []
    if (!kids.length) {
      if (ids.has(s.id)) {
        if (!one) flush()
        out.push({ kind: 'step', step: s })
      } else if (s.status === 'todo') run.push(s)
      continue
    }
    if (!kids.some(c => ids.has(c.id))) {
      run.push(...kids.filter(c => c.status === 'todo'))
      continue
    }
    if (!one) flush()
    const inner: KidSlot[] = []
    let hid: Step[] = []
    for (const c of kids) {
      if (ids.has(c.id)) {
        if (hid.length) inner.push({ kind: 'more', steps: hid })
        hid = []
        inner.push({ kind: 'step', step: c })
      } else if (c.status === 'todo') (one ? run : hid).push(c)
    }
    if (hid.length) inner.push({ kind: 'more', steps: hid })
    out.push({ kind: 'group', step: s, kids: inner })
  }
  flush()
  return out
}

function compact(ls: Step[], fit: Fit, steps: Step[]): { ids: Set<string>; moreDone: number } {
  const ids = new Set(ls.filter(s => s.status === 'doing' || s.status === 'blocked').map(s => s.id))
  const fin = ls.filter(s => isFinal(s.status))
  const todo = ls.filter(s => s.status === 'todo')
  // 가장 늦게 끝난 것. 끝난 시각이 같으면 순서상 뒤의 것.
  const last = fin.reduce<Step | undefined>((a, s) => (a && (a.endedAt ?? -1) > (s.endedAt ?? -1) ? a : s), undefined)
  if (fit.recent && last) ids.add(last.id)
  for (const s of todo.slice(0, fit.todo)) ids.add(s.id)
  const end = ls.at(-1)
  if (fit.end && end?.status === 'todo') ids.add(end.id)
  // 숨는 것이 딱 1개이고 맨 위 단계이며 메모가 없으면 "1개 더" 대신 그 단계를 그린다. 줄 수가 같을 때만이다.
  // 끝남은 숨는 것 전체로 보되, 그리면 숨긴 예정 덩어리가 나뉘어 줄이 늘면 개수로 둔다(2026-11-25 사용자가 고름).
  // 예정은 숨은 자리(덩어리)마다 본다. 이미 그리는 묶음 안의 덩어리는 묶음 머리가 있으니 그 안 단계도 그린다.
  // 맨 위 덩어리는 맨 위 단계만(그리지 않는 묶음의 단계를 그리면 묶음 머리 줄이 는다).
  const top = new Set(steps.map(s => s.id))
  const lone = (hidden: Step[]) => (hidden.length === 1 && !hidden[0]!.note ? hidden[0] : undefined)
  const runs = (shown: Set<string>) =>
    slots(steps, shown, fit.one).reduce(
      (n, sl) => n + (sl.kind === 'more' ? 1 : sl.kind === 'group' ? sl.kids.filter(k => k.kind === 'more').length : 0),
      0,
    )
  const f = lone(fin.filter(s => !ids.has(s.id)))
  if (f && top.has(f.id) && runs(new Set([...ids, f.id])) === runs(ids)) ids.add(f.id)
  for (const sl of slots(steps, ids, fit.one)) {
    const s = sl.kind === 'more' ? lone(sl.steps) : undefined
    if (s && top.has(s.id)) ids.add(s.id)
    if (sl.kind !== 'group') continue
    for (const k of sl.kids) {
      const c = k.kind === 'more' ? lone(k.steps) : undefined
      if (c) ids.add(c.id)
    }
  }
  return { ids, moreDone: fin.filter(s => !ids.has(s.id)).length }
}

// 화면 폭: 한글·전각·이모지는 2칸, 이모지 이음 글자(U+FE0F 모양 고르기, U+200D 잇기, U+20E3 키캡)는 0칸.
// 다만 1칸 글자 뒤의 U+FE0F는 그 글자를 이모지로 그려 2칸으로 만든다(⚠️, ✔️, 1️⃣). 늘어난 1칸을 U+FE0F 몫으로 센다.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Emoji_Presentation}/u

function width(ch: string, prev = ''): number {
  const c = ch.codePointAt(0) ?? 0
  if (c === 0xfe0f) return prev && width(prev) === 1 ? 1 : 0
  if (c === 0x200d || c === 0x20e3) return 0
  return WIDE.test(ch) ? 2 : 1
}

function cells(text: string): number {
  let n = 0
  let prev = ''
  for (const ch of text) {
    n += width(ch, prev)
    prev = ch
  }
  return n
}

// 번호 글자(원문자 ①, 괄호 숫자 ⑴, 원 영문자 Ⓐ, 로마 숫자 Ⅳ 등)는 폭이 모호하다. 터미널은 1칸을 주는데
// 글꼴이 2칸으로 그려 다음 글자를 덮는다. 보통 글자로 바꾸고, 붙은 번호끼리는 쉼표로 나눈다(④⑤ → 4,5).
// 한글 호환 자모(ㅋ)가 바뀌지 않게 글 전체가 아니라 번호 글자만 NFKC로 바꾼다.
function numeral(c: number): string | undefined {
  if (c >= 0x2776 && c <= 0x2793) return String(((c - 0x2776) % 10) + 1) // ❶–❿, ➀–➉, ➊–➓
  if (c >= 0x24eb && c <= 0x24f4) return String(c - 0x24eb + 11) // ⓫–⓴
  if (c >= 0x24f5 && c <= 0x24fe) return String(c - 0x24f5 + 1) // ⓵–⓾
  if (c === 0x24ff) return '0' // ⓿
  if ((c >= 0x2460 && c <= 0x24ff) || (c >= 0x2160 && c <= 0x2188)) {
    const s = String.fromCodePoint(c).normalize('NFKC')
    return s === String.fromCodePoint(c) ? undefined : s
  }
  return undefined
}

// 맨 앞 번호 하나 뒤에 빈칸이 오면 목록 번호로 읽히게 점을 붙인다(❶ 자료 → 1. 자료).
// ⑴ → (1)처럼 제 표시가 있는 번호는 그대로 둔다. 번호 글자는 모두 한 글자 단위(BMP)라 text[1]이 그 뒤 글자다.
function plain(text: string): string {
  const lead = numeral(text.codePointAt(0) ?? 0)
  if (lead && /^[0-9A-Za-z]+$/.test(lead) && text[1] === ' ') text = `${lead}.${text.slice(1)}`
  let out = ''
  let after = false
  for (const ch of text) {
    const n = numeral(ch.codePointAt(0) ?? 0)
    if (n === undefined) {
      // 바꾼 번호 바로 뒤의 보통 숫자도 쉼표로 나눈다(그림 ③4 → 그림 3,4).
      if (after && /[0-9]$/.test(out) && /[0-9]/.test(ch)) out += ','
      out += ch
      after = false
      continue
    }
    // 바꾼 번호끼리(④⑤ → 4,5), 또는 보통 숫자 바로 뒤의 번호(Task 1① → Task 1,1)는 쉼표로 나눠 다른 수로 읽히지 않게 한다.
    const sep = after ? /[0-9A-Za-z]$/.test(out) && /^[0-9A-Za-z]/.test(n) : /[0-9]$/.test(out) && /^[0-9]/.test(n)
    if (sep) out += ','
    out += n
    after = true
  }
  return out
}

function cut(text: string, room: number): string {
  text = plain(text)
  if (cells(text) <= room) return text
  if (room <= 1) return room === 1 ? '…' : ''
  let out = ''
  let used = 0
  let prev = ''
  for (const ch of text) {
    const w = width(ch, prev)
    if (used + w > room - 1) break
    out += ch
    used += w
    prev = ch
  }
  return `${out}…`
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? ''
}

// 따옴표 밖의 첫 |·&&·||·;·&·출력 돌리기(>, 2>, <) 앞까지. 맨 앞의 PowerShell 호출 연산자 &는 남긴다.
function firstCommand(s: string): string {
  let quote: string | undefined
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? ''
    if (quote) {
      if (ch === quote) quote = undefined
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (!'|;&<>'.includes(ch)) continue
    if (ch === '&' && s.slice(0, i).trim() === '') continue
    let end = i
    // "2>" 의 2 도 함께 뗀다.
    if (ch === '>' && /\d/.test(s[i - 1] ?? '') && /^\s?$/.test(s[i - 2] ?? '')) end = i - 1
    const head = s.slice(0, end).trim()
    return head || s.trim()
  }
  return s.trim()
}

// 설명이 없을 때: 첫 줄에서 앞의 "cd 경로 &&"(또는 ;)를 떼고, 첫 명령만 남기고, 절대 경로는 마지막 이름만 남긴다.
function shortCommand(command: string): string {
  let s = firstLine(command)
  s = s.replace(/^(?:(?:cd|Set-Location|pushd)\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*)+/i, '')
  s = firstCommand(s)
  const tail = (p: string) => p.split(/[\\/]+/).filter(Boolean).pop() ?? p
  const isAbsolute = (p: string) => /^(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!dev\/null\b))/.test(p)
  s = s.replace(/"([^"]*)"|'([^']*)'/g, (m, dq?: string, sq?: string) => {
    const p = dq ?? sq ?? ''
    return isAbsolute(p) ? tail(p) : m
  })
  s = s.replace(/(^|[\s=])([^\s"'|&;<>=]+)/g, (m, lead: string, p: string) => (isAbsolute(p) ? lead + tail(p) : m))
  return s.trim()
}

// 돌고 있는 명령 한 줄의 글. 종류(흐리게)와 대상을 따로 두어 좁으면 대상만 줄인다.
type Label = { label: string; kind?: string; target?: string }

// 파일 종류: 좁으면 폴더부터 뺀다.
const FILE_KINDS = new Set(['읽기', '수정', '작성'])

function labelOf(e: { tool: string }): Label {
  const args = e as unknown as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  // "- Read"만으로는 무엇을 보는지 모른다. 종류와 대상(폴더/파일, 찾는 말과 범위, 주소)을 함께 보인다.
  const of = (kind: string, target: string): Label => (target ? { label: `${kind} ${target}`, kind, target } : { label: kind })
  const parts = (key: string) => str(args[key]).split(/[\\/]+/).filter(p => p && p !== '.')
  // 경로는 마지막 두 마디(폴더/파일)만. 같은 이름의 파일이 여러 폴더에 있어도 구분된다.
  const file = (key: string) => parts(key).slice(-2).join('/')
  const where = (s: string) => (s ? ` · ${s}` : '')
  // 검색·찾기 범위는 경로의 끝 이름. .. ~ 드라이브(C:)뿐이면 범위로 뜻이 없으므로 없는 것으로 본다.
  const scopeOf = (key: string) => {
    const last = parts(key).at(-1)
    return last && !/^(\.\.|~|[A-Za-z]:)$/.test(last) ? last : undefined
  }
  // 명령은 Claude가 붙인 짧은 설명을 쓴다. 명령 첫 줄은 경로 때문에 잘려 무엇을 하는지 안 보인다.
  if (e.tool === 'Bash' || e.tool === 'PowerShell') {
    return { label: firstLine(str(args.description)) || shortCommand(str(args.command)) || e.tool }
  }
  if (e.tool === 'Agent') return of('에이전트', firstLine(str(args.description)) || '작업')
  if (e.tool === 'Monitor') return of('모니터', firstLine(str(args.description)) || '감시')
  if (e.tool === 'Read') {
    // 줄 범위: offset이 있으면 ":시작", limit도 있으면 ":시작-끝".
    const from = num(args.offset)
    const n = num(args.limit)
    const lines = from === undefined ? '' : n ? `:${from}-${from + n - 1}` : `:${from}`
    return of('읽기', file('file_path') && file('file_path') + lines)
  }
  if (e.tool === 'Edit') return of('수정', file('file_path'))
  if (e.tool === 'Write') return of('작성', file('file_path'))
  if (e.tool === 'NotebookEdit') return of('수정', file('notebook_path'))
  if (e.tool === 'Grep') {
    // 범위: 경로가 있으면 그 끝 이름, 없으면 glob, 그것도 없으면 type.
    const pattern = firstLine(str(args.pattern))
    const scope = scopeOf('path') ?? (firstLine(str(args.glob)) || firstLine(str(args.type)))
    return of('검색', pattern && `"${pattern}"${where(scope)}`)
  }
  if (e.tool === 'Glob') {
    const pattern = firstLine(str(args.pattern))
    return of('찾기', pattern && `${pattern}${where(scopeOf('path') ?? '')}`)
  }
  if (e.tool === 'WebSearch') return of('웹 검색', str(args.query) && `"${firstLine(str(args.query))}"`)
  if (e.tool === 'WebFetch') return of('웹 페이지', /^[a-z]+:\/\/([^/?#]+)/i.exec(str(args.url))?.[1] ?? '')
  if (e.tool === 'Skill') return str(args.skill) ? of('스킬', str(args.skill)) : { label: e.tool }
  // MCP 도구는 서버 이름이 길어 잘리므로 도구 이름만 보인다.
  const mcp = /^mcp__(.+?)__(.+)$/.exec(e.tool)
  if (mcp) return { label: mcp[2] ?? e.tool }
  return { label: e.tool }
}

// 좁을 때 대상 줄이기: 파일은 폴더, 줄 범위 차례로 빼고, 그래도 넘치면 끝을 자른다.
function fitTarget(kind: string, target: string, room: number): string {
  if (!FILE_KINDS.has(kind)) return cut(target, room)
  const name = target.replace(/^.*\//, '')
  const bare = name.replace(/:\d+(?:-\d+)?$/, '')
  return cut([target, name].find(t => cells(plain(t)) <= room) ?? bare, room)
}

// 돌고 있는 명령을 붙일 단계: 진행 중인 아래 단계 가운데 가장 나중에 시작한 것. 없으면 맨 아래에 둔다.
// 막혔다가 다시 진행 중이 된 단계는 그때 시작한 것으로 본다(사용자가 정함, 2026-11-24).
function callsAt(ls: Step[]): string | undefined {
  const since = (s: Step) => s.doingSince ?? s.startedAt ?? 0
  let at: Step | undefined
  for (const s of ls) {
    if (s.status === 'doing' && (!at || since(s) > since(at))) at = s
  }
  return at?.id
}

function backgroundTaskOf(r: unknown): string | undefined {
  if (!r || typeof r !== 'object') return undefined
  const result = (r as { result?: unknown }).result
  if (!result || typeof result !== 'object') return undefined
  const id = (result as Record<string, unknown>).backgroundTaskId
  return typeof id === 'string' && id ? id : undefined
}

function summary(b: Board | null): string {
  if (!b) return '진행 상황 목록이 비어 있습니다.'
  const ls = leaves(b.steps)
  const done = ls.filter(s => isFinal(s.status)).length
  const line = (s: Step, st: StepStatus, pad: string) =>
    `${pad}- [${st}] ${s.id}: ${s.label}${s.note ? ` (${s.note})` : ''}`
  const lines = [`진행 상황: ${b.title} (${done}/${ls.length} 완료)`]
  for (const s of b.steps) {
    lines.push(line(s, shown(s).status, ''))
    for (const c of s.children ?? []) lines.push(line(c, c.status, '  '))
  }
  return lines.join('\n')
}

function notice(b: Board): string {
  return [
    '[진행 상황 패널] 이 창이 꺼진 창의 진행 목록을 이어받았습니다.',
    '지금 하려는 일과 같은 일이면 이 목록을 이어서 update하고, 다른 일이면 plan으로 새로 적으세요.',
    summary(b),
  ].join('\n')
}

// ── 입력 확인 ─────────────────────────────────────────

type StepInput = { id: string; label: string; status?: StepStatus; children?: StepInput[] }

function parseSteps(raw: unknown, depth: number, ids: Set<string>): StepInput[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'steps에 단계를 하나 이상 적어 주세요.'
  const out: StepInput[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return 'steps의 항목은 {id, label} 모양이어야 합니다.'
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const label = typeof o.label === 'string' ? o.label.trim() : ''
    if (!id || !label) return 'steps의 항목마다 id와 label이 있어야 합니다.'
    if (ids.has(id)) return `단계 id "${id}"가 두 번 나옵니다.`
    ids.add(id)
    if (o.status !== undefined && !STATUSES.includes(o.status as StepStatus)) {
      return `단계 "${id}"의 status는 ${STATUSES.join('|')} 중 하나여야 합니다.`
    }
    const step: StepInput = { id, label, status: o.status as StepStatus | undefined }
    if (o.children !== undefined) {
      if (depth > 0) return `단계 "${id}": children은 한 층까지만 적을 수 있습니다.`
      const kids = parseSteps(o.children, depth + 1, ids)
      if (typeof kids === 'string') return kids
      step.children = kids
    }
    out.push(step)
  }
  return out
}

function buildSteps(input: StepInput[], old: Board | null, t: number): Step[] {
  return input.map(s => {
    const prev = old ? findStep(old.steps, s.id) : undefined
    const status = s.status ?? prev?.status ?? 'todo'
    const step: Step = { id: s.id, label: s.label, status }
    if (status !== 'todo' && prev) {
      if (prev.startedAt !== undefined) step.startedAt = prev.startedAt
      if (prev.endedAt !== undefined && status !== 'doing') step.endedAt = prev.endedAt
      if (prev.note) step.note = prev.note
      if (prev.doingSince !== undefined && status === 'doing') step.doingSince = prev.doingSince
    }
    if (status === 'doing' && step.startedAt === undefined) step.startedAt = t
    if (status === 'doing' && prev?.status !== 'doing') step.doingSince = t
    if (s.children) step.children = buildSteps(s.children, old, t)
    return step
  })
}

// ── 상태 쓰기 ─────────────────────────────────────────

// 이 창의 폴더·세션 id. 다시 불러온 직후 session.start 보다 먼저 도구가 불려도 여기서 채운다.
// 세션 id 는 부를 때마다 다시 읽는다. /resume·/clear 는 같은 프로그램 안에서 id 만 바꾸고 session.start 를
// 부르지 않으므로, 바뀐 것을 여기서 알아채 새 세션의 목록을 고른다(2026-11-18 /resume 뒤 목록이 사라진 일).
async function whoAmI($: EngineInterface): Promise<{ root: string; sid: string }> {
  if (switching) await switching
  const sid = await $.session.id()
  if (me && me.sid === sid) return me
  const before = me
  const root = (await $.session.root()).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  me = { root, sid }
  if (before && before.sid !== sid) {
    const who = me
    switching = switchTo($, who).finally(() => {
      switching = undefined
    })
    await switching
  }
  return me
}

// 같은 프로그램 안에서 다른 세션이 되었다. 앞 세션의 목록은 그 세션 이름으로 저장소에 남겨 두고,
// 새 세션은 session.start 처럼 제 목록 → 꺼진 창(/resume 으로 끝난 앞 세션 포함)의 목록 → 없음 순서로 고른다.
async function switchTo($: EngineInterface, who: { root: string; sid: string }): Promise<void> {
  const t = await $.clock.now()
  await update($, owner, () => who.sid)
  await update($, board, () => null)
  const picked = await pick($, who.root, who.sid, t)
  await update($, board, cur => cur ?? picked?.board ?? null)
  await update($, now, () => t)
  pendingNotice = picked?.adopted ? notice(picked.board) : undefined
  await syncTicker($)
  if (picked && !allFinal(picked.board)) await $.ui.open(OPEN)
}

async function save($: EngineInterface, b: Board | null, t: number): Promise<void> {
  const who = await whoAmI($)
  await update($, board, () => b)
  await update($, now, () => t)
  const key = `board:${who.root}:${who.sid}`
  if (b) {
    const saved: BoardEntry = { root: who.root, sessionId: who.sid, lastSeen: t, board: b }
    await $.store.set(key, saved)
  } else {
    await $.store.delete(key)
  }
  await syncTicker($)
}

// 실행 중인 호출이나 떠 있는 알림이 있으면 1초마다, 진행 중 단계만 있으면 30초마다 시간을 다시 그린다.
async function syncTicker($: EngineInterface): Promise<void> {
  const b = await read($, board)
  const r = await read($, running)
  const al = await read($, alerts)
  const fast = r.length > 0 || al.length > 0
  const ms = fast ? 1000 : b && leaves(b.steps).some(s => s.status === 'doing') ? 30_000 : 0
  if (ticker && ticker.ms === ms) return
  ticker?.timer.cancel()
  ticker = undefined
  if (ms === 0) return
  ticker = {
    ms,
    timer: $.clock.every(ms, () => {
      void tick($)
    }),
  }
}

// 시각을 올리고, 5초가 지난 알림을 내린다. 알림이 다 내려가면 느린 주기로 돌아간다.
async function tick($: EngineInterface): Promise<void> {
  const t = await $.clock.now()
  await update($, now, () => t)
  const al = await read($, alerts)
  if (al.some(a => t - a.at >= ALERT_MS)) {
    await update($, alerts, list => list.filter(a => t - a.at < ALERT_MS))
    await syncTicker($)
  }
}

async function raise($: EngineInterface, fresh: { kind: AlertKind; text: string }[], t: number): Promise<void> {
  if (fresh.length === 0) return
  const added: Alert[] = fresh.map(f => ({ ...f, id: ++seq, at: t }))
  await update($, alerts, list => [...list.filter(a => t - a.at < ALERT_MS), ...added].slice(-MAX_ALERTS))
  await syncTicker($)
}

// Claude가 쉬기 시작함(일이 끝남, 질문·승인 창이 뜸). 이미 쉬는 중이면 그대로 둔다.
async function rest($: EngineInterface, t: number): Promise<void> {
  const b = await read($, board)
  if (!b || b.pausedSince !== undefined) return
  await save($, { ...b, pausedSince: t }, t)
}

// Claude가 다시 일함. 쉰 시간을 합에 더한다.
async function wake($: EngineInterface, t: number): Promise<void> {
  const b = await read($, board)
  if (!b || b.pausedSince === undefined) return
  const { pausedSince, ...others } = b
  await save($, { ...others, paused: (b.paused ?? 0) + (t - pausedSince) }, t)
}

async function heartbeat($: EngineInterface): Promise<void> {
  if (!me) return
  const who = await whoAmI($)
  const b = await read($, board)
  if (!b) return
  const t = await $.clock.now()
  const saved: BoardEntry = { root: who.root, sessionId: who.sid, lastSeen: t, board: b }
  await $.store.set(`board:${who.root}:${who.sid}`, saved)
}

// 이 창의 목록을 고른다: 같은 세션 → 꺼진 창의 가장 최근 목록 → 없음.
async function pick(
  $: EngineInterface,
  root: string,
  sid: string,
  t: number,
): Promise<{ board: Board; adopted: boolean } | undefined> {
  const own = `board:${root}:${sid}`
  const prefix = `board:${root}:`
  const keys = (await $.store.keys()).filter(k => k.startsWith('board:'))
  let picked: { board: Board; adopted: boolean } | undefined

  if (keys.includes(own)) {
    const saved = (await $.store.get(own)) as BoardEntry | undefined
    if (saved?.board) picked = { board: saved.board, adopted: false }
  } else {
    let best: { key: string; saved: BoardEntry } | undefined
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue
      const saved = (await $.store.get(key)) as BoardEntry | undefined
      if (!saved?.board || t - saved.lastSeen < ORPHAN_MS) continue
      if (!best || saved.board.updatedAt > best.saved.board.updatedAt) best = { key, saved }
    }
    if (best) {
      const moved: BoardEntry = { ...best.saved, sessionId: sid, lastSeen: t }
      await $.store.set(own, moved)
      await $.store.delete(best.key)
      picked = { board: best.saved.board, adopted: true }
    }
  }

  await prune($, own)
  return picked
}

async function prune($: EngineInterface, own: string): Promise<void> {
  const keys = (await $.store.keys()).filter(k => k.startsWith('board:') && k !== own)
  if (keys.length < KEEP) return
  const dated: { key: string; lastSeen: number }[] = []
  for (const key of keys) {
    const saved = (await $.store.get(key)) as BoardEntry | undefined
    dated.push({ key, lastSeen: saved?.lastSeen ?? 0 })
  }
  dated.sort((a, b) => a.lastSeen - b.lastSeen)
  for (const { key } of dated.slice(0, keys.length - (KEEP - 1))) await $.store.delete(key)
}

// 그리는 훅이 기다리는 값을 신호가 끊기면 놓고 바로 끝낸다. 컴퓨터가 몹시 느리면 $ 호출이 30초 한도를 넘겨
// 엔진이 그리기를 건너뛰는데, 그 뒤에도 훅이 5초 넘게 남아 있으면 '신호를 무시했다'고 센다. 2번 이어지면
// hooks worker를 갈아 그때 돌던 도구 호출이 실패한다(2026-11-24, Read가 "ignored its signal 2 times"로 실패).
// p에는 늘 처리기를 단다. 이미 끊겼어도 나중에 p가 거절되면 처리되지 않은 거절로 남지 않게.
function orStop<T>(signal: AbortSignal, p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason)
    signal.addEventListener('abort', stop, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop))
    if (signal.aborted) stop()
  })
}

// ── 훅 ────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    me = undefined
    const { root, sid } = await whoAmI($)

    await $.tool.register(SPEC)
    await $.command.register({
      name: 'progress',
      description: '진행 상황 패널을 열거나 닫습니다. clear를 붙이면 목록을 지웁니다.',
      argumentHint: '[clear]',
    })

    const t = await $.clock.now()
    // $.state 는 다시 불러와도 남는다. 이 세션이 이미 목록을 그리고 있으면(다시 불러온 경우) 그것이 가장 새것이라
    // 저장소의 옛 목록으로 덮지 않고, 오히려 저장소를 그것으로 맞춘다.
    // 세션 id 가 바뀌었으면(/clear 등) $.state 에 남은 목록은 이 세션 것이 아니다.
    const isSameSession = (await read($, owner)) === sid
    await update($, owner, () => sid)
    const live = isSameSession ? await read($, board) : null
    if (!isSameSession) await update($, board, () => null)
    const picked = live ? undefined : await pick($, root, sid, t)
    if (live) {
      const saved: BoardEntry = { root, sessionId: sid, lastSeen: t, board: live }
      await $.store.set(`board:${root}:${sid}`, saved)
    }
    // 시작 처리 도중 도구로 적힌 목록이 있으면 그것을 남긴다.
    await update($, board, cur => cur ?? picked?.board ?? null)
    await update($, now, () => t)
    await update($, running, list => list.filter(r => !r.isBackground || t - r.startedAt < BACKGROUND_TTL_MS))
    pendingNotice = picked?.adopted ? notice(picked.board) : undefined

    beat?.cancel()
    beat = $.clock.every(BEAT_MS, () => {
      void heartbeat($)
    })
    await syncTicker($)
    if (picked && !allFinal(picked.board)) await $.ui.open(OPEN)

    return next(e)
  })

  // /resume·/clear 로 이 세션이 끝나고 같은 프로그램이 다른 세션으로 이어진다(session.start 는 오지 않는다).
  // 끝나는 세션의 목록은 저장소에 그대로 두고 패널에서만 내린다. /resume 이면 그 목록을 꺼진 창의 것으로 표시해
  // 돌아간 세션이 제 목록이 없을 때 바로 이어받게 한다(NEW 로 켜서 OLD 의 목록을 가져온 뒤 OLD 로 돌아간 경우).
  on('session.end', async ($, e, next) => {
    if ((e.reason === 'resume' || e.reason === 'clear') && me && e.sessionId === me.sid) {
      if (e.reason === 'resume') {
        const key = `board:${me.root}:${me.sid}`
        const saved = (await $.store.get(key)) as BoardEntry | undefined
        if (saved?.board) await $.store.set(key, { ...saved, lastSeen: 0 })
      }
      await update($, board, () => null)
      pendingNotice = undefined
      await syncTicker($)
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // 실패해도 세션은 그대로 끝난다.

  // Claude가 부르는 도구. 권한 확인 앞(tool.call)에서 답해 자리를 비운 밤에도 묻지 않는다.
  on('tool.call', { tool: 'mcp__progress-panel__progress' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { deny: '서브 에이전트는 진행 상황 패널을 고치지 않습니다. 메인 대화에서만 씁니다.' }
    }
    const a = e as unknown as Record<string, unknown>
    await whoAmI($) // 세션이 바뀌었으면 먼저 새 세션의 목록으로 바꾼다.
    const t = await $.clock.now()
    const current = await read($, board)

    if (a.action === 'show') return { result: summary(current) }

    if (a.action === 'clear') {
      await save($, null, t)
      return { result: summary(null) }
    }

    if (a.action === 'plan') {
      const input = parseSteps(a.steps, 0, new Set())
      if (typeof input === 'string') return { deny: input }
      const title = typeof a.title === 'string' && a.title.trim() ? a.title.trim() : '진행 상황'
      // 같은 제목이면 같은 일을 다시 적는 것이라 같은 id 단계의 상태·시간을 이어받는다. 제목이 다르면 새 일이다.
      const same = current && current.title === title ? current : null
      const next: Board = { title, steps: buildSteps(input, same, workTime(same, t)), updatedAt: t }
      if (same?.paused !== undefined) next.paused = same.paused
      if (same?.pausedSince !== undefined) next.pausedSince = same.pausedSince
      await save($, next, t)
      await $.ui.open(OPEN)
      return { result: summary(next) }
    }

    if (a.action === 'update') {
      if (!current) return { deny: '아직 목록이 없습니다. 먼저 action "plan"으로 단계를 적어 주세요.' }
      const id = typeof a.id === 'string' ? a.id : ''
      const status = a.status as StepStatus
      if (!STATUSES.includes(status)) return { deny: `status는 ${STATUSES.join('|')} 중 하나여야 합니다.` }
      const copy = JSON.parse(JSON.stringify(current)) as Board
      const step = findStep(copy.steps, id)
      if (!step) return { deny: `단계 id "${id}"가 목록에 없습니다. 있는 id: ${leaves(copy.steps).map(s => s.id).join(', ')}` }
      if (step.children?.length) {
        return { deny: `"${id}"는 묶음이라 아래 단계의 상태로 정해집니다. 아래 단계를 update해 주세요.` }
      }
      const wasAllFinal = allFinal(copy)
      const w = workTime(copy, t)

      if (status === 'doing') {
        step.startedAt ??= w
        if (step.status !== 'doing') step.doingSince = w
        delete step.endedAt
      } else if (status === 'todo') {
        delete step.startedAt
        delete step.endedAt
      } else {
        step.endedAt = w
      }
      step.status = status
      const note = typeof a.note === 'string' ? a.note.trim() : ''
      if (note) step.note = note
      else delete step.note
      copy.updatedAt = t
      await save($, copy, t)

      // 기본 알림창 대신 입력창 바로 위에 색 테두리 상자로 5초 동안 띄운다.
      const fresh: { kind: AlertKind; text: string }[] = []
      if (status === 'done') {
        const took = step.startedAt !== undefined ? fmt(w - step.startedAt) : ''
        fresh.push({ kind: 'done', text: `✓ ${plain(step.label)} 완료${took ? ` (${took} 걸림)` : ''}` })
      } else if (status === 'blocked') {
        fresh.push({ kind: 'blocked', text: `⚠ ${plain(step.label)}에서 막힘${note ? `: ${plain(note)}` : ''}` })
      }
      if (!wasAllFinal && allFinal(copy)) fresh.push({ kind: 'all', text: '✓ 모든 단계 완료' })
      await raise($, fresh, t)

      return { result: summary(copy) }
    }

    return { deny: 'action은 plan, update, show, clear 중 하나여야 합니다.' }
  }).catch(() => ({ deny: '진행 상황 패널 도구에서 오류가 났습니다. 이번 단계 기록은 건너뛰고 일을 이어 가세요.' }))

  // 메인 대화에서 돌고 있는 도구 호출을 적어 둔다(자기 도구와 서브 에이전트는 빼고).
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined || e.tool === TOOL) return next(e)
    const id = e.tool_use_id ?? `call-${(seq += 1)}`
    const label = labelOf(e)
    const t = await $.clock.now()
    await update($, running, list => [...list, { id, ...label, startedAt: t, isBackground: false }])
    await update($, now, () => t)
    await syncTicker($)
    const waits = WAITING.has(e.tool)
    if (waits) await rest($, t)
    let taskId: string | undefined
    try {
      const r = await next(e)
      taskId = backgroundTaskOf(r)
      return r
    } finally {
      const keep: Running[] = taskId ? [{ id, ...label, startedAt: t, isBackground: true, taskId }] : []
      await update($, running, list => [...list.filter(x => x.id !== id), ...keep])
      await syncTicker($)
      if (waits && !between) await wake($, await $.clock.now())
    }
  }).catch(($, e, next) => next(e)) // 기록이 실패해도 도구는 그대로 돈다(이미 돌았으면 그 결과를 그대로).

  // Claude가 일하는 동안만 시간을 센다: 턴이 끝나면 멈추고, 다음 턴이 시작하면 다시 센다.
  // 창이 꺼져 있던 시간도 마지막 턴 끝에서 멈춘 채로 저장되어 빠진다.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    between = false
    await wake($, await $.clock.now())
    return next(e)
  }).catch(($, e, next) => next(e)) // 실패해도 턴은 그대로 돈다.

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    between = true
    await rest($, await $.clock.now())
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'task-notification') {
      await update($, running, list => list.filter(x => !(x.taskId && e.text.includes(x.taskId))))
      await syncTicker($)
      return next(e)
    }
    await whoAmI($) // /resume 바로 뒤의 첫 입력이면 여기서 새 세션의 목록을 고르고, 이어받았으면 안내를 붙인다.
    if (pendingNotice) {
      const note = pendingNotice
      pendingNotice = undefined
      return next({ ...e, context: [...(e.context ?? []), note] })
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // 실패해도 프롬프트는 그대로 들어간다.

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!e.tools.includes(TOOL)) return r
    return { sections: [...r.sections, RULES] }
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await save($, null, await $.clock.now())
      return { text: '진행 상황 목록을 지웠습니다.' }
    }
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    if (pane?.isPlaced) {
      await $.ui.close({ id: PANE })
      return { text: '진행 상황 패널을 닫았습니다.' }
    }
    await $.ui.open(OPEN)
    return { text: '진행 상황 패널을 열었습니다.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    const [b, calls, t] = await orStop(next.signal, Promise.all([read($, board), read($, running), read($, now)]))
    // 단계 시간은 일한 시각으로, 돌고 있는 명령은 벽시계로.
    const w = workTime(b, t)
    const cols = Math.max(16, e.props.bodyColumns)

    // 단계 아래에 붙는 줄의 앞부분: 묶음 안이면 세로선(마지막 가지 └─ 아래는 빈칸, rail: null), 그리고 점선.
    // 글자는 단계 이름과 같은 칸에서 시작한다.
    type Lead = { rail?: Color | null; dot: Color }
    const leadOf = (l: Lead): RenderChildren[] => [
      ...(l.rail ? [<Text color={l.rail}>│</Text>, ' '] : l.rail === null ? ['  '] : []),
      <Text color={l.dot}>┆</Text>,
      ' ',
    ]
    const leadCells = (l: Lead) => (l.rail === undefined ? 2 : 4)

    // 한 줄: [가지] 표시(상태 색) + 이름(상태별 강조) + 오른쪽 끝 시간.
    // 묶음 안 단계는 진행선에서 가지를 친다(├─, 목록 맨 끝 묶음의 마지막 단계는 └─).
    type Branch = { color: Color; last: boolean }
    const row = (st: Shown, label: string, isGroup: boolean, branch?: Branch) => {
      const head = branch ? 4 : 2
      const right = timeText(st, w)
      const room = cols - head - (right ? cells(right) + 1 : 0)
      const name = cut(label, room)
      const gap = right ? ' '.repeat(Math.max(1, cols - head - cells(name) - cells(right))) : ''
      // 묶음 이름은 기본 색 굵게(주황은 진행 중인 단계 이름에만). 끝났거나 건너뛴 묶음은 끝난 단계처럼 물러난다.
      const ls: Style = isGroup ? (isFinal(st.status) ? { dimColor: true } : { bold: true }) : LABEL[st.status]
      const ts = TIME[st.status]
      return (
        <Text>
          {branch ? <Text color={branch.color}>{branch.last ? '└─' : '├─'}</Text> : ''}
          <Text color={COLOR[st.status]}>{MARK[st.status]}</Text>
          {' '}
          <Text color={ls.color} bold={ls.bold} dimColor={ls.dimColor} strikethrough={ls.strikethrough}>
            {name}
          </Text>
          {gap}
          {right ? (
            <Text color={ts.color} dimColor={ts.dimColor}>
              {right}
            </Text>
          ) : (
            ''
          )}
        </Text>
      )
    }

    // 명령 줄(사용자가 고름, 2026-11-24): 한 호출에 한 줄 "▶ 종류 대상". ▶는 앞 점선과 같은 색, 종류는 흐리게.
    // 다섯 줄까지, 넘으면 "외 n개".
    const callLines = (l: Lead, list: Running[]): RenderChildren[] => {
      const room = cols - leadCells(l) - 2
      const out: RenderChildren[] = list.slice(0, MAX_CALLS).map(c => (
        <Text>
          {leadOf(l)}
          <Text color={l.dot}>▶</Text>
          {' '}
          {c.kind && c.target ? <Text dimColor>{c.kind}</Text> : ''}
          {c.kind && c.target ? ` ${fitTarget(c.kind, c.target, room - cells(c.kind) - 1)}` : cut(c.label, room)}
        </Text>
      ))
      const hidden = list.length - MAX_CALLS
      if (hidden > 0) {
        out.push(
          <Text>
            {leadOf(l)}
            <Text dimColor>{`외 ${hidden}개`}</Text>
          </Text>,
        )
      }
      return out
    }

    // 돌고 있는 명령: 진행 중 단계 아래에. 그런 단계가 없으면 맨 아래에.
    // 같은 글(같은 파일을 두 번 읽는 등)은 한 줄로.
    const visible = calls.filter(c => t - c.startedAt >= SHOW_AFTER_MS)
    const once = (list: Running[]) => list.filter((c, i) => list.findIndex(d => d.label === c.label) === i)
    const at = b ? callsAt(leaves(b.steps)) : undefined
    // 백그라운드 명령은 늘 목록 맨 아래에(사용자가 정함, 2026-11-24). 진행 중 단계 아래에는 그 밖의 명령만.
    // 같은 글은 자리마다 따로 합친다(같은 설명의 백그라운드 명령이 있어도 지금 도는 명령은 단계 아래에 보인다).
    const hung = once(at ? visible.filter(c => !c.isBackground) : [])
    const below = once(at ? visible.filter(c => c.isBackground) : visible)

    // 한 단계 아래에 붙는 줄: 메모(막힘이면 노랑, 아니면 흐리게), 이어서 그 단계에서 돌고 있는 명령.
    const hang = (l: Lead, step: Step): RenderChildren[] => {
      const out: RenderChildren[] = []
      if (step.note) {
        const note = cut(step.note, cols - leadCells(l))
        out.push(
          <Text>
            {leadOf(l)}
            {step.status === 'blocked' ? <Text color="warning">{note}</Text> : <Text dimColor>{note}</Text>}
          </Text>,
        )
      }
      if (step.id === at) out.push(...callLines(l, hung))
      return out
    }

    // 숨긴 것의 개수 줄: "┆ 완료 3개 더", "┆ 예정 2개 더".
    const moreLine = (color: Color, text: string) => (
      <Text>
        <Text color={color}>┆</Text>
        {' '}
        <Text dimColor>{text}</Text>
      </Text>
    )

    const bottom = callLines({ dot: 'subtle' }, below)

    const body: RenderChildren[] = []
    if (!b) {
      body.push(
        <Box key="empty" marginBottom={1}>
          <Text dimColor>아직 진행 목록이 없습니다.</Text>
        </Box>,
      )
    } else {
      const ls = leaves(b.steps)
      const done = ls.filter(s => isFinal(s.status)).length
      // 머리 둘째 줄: 가는 막대(끝난 몫 초록) + 완료 수/전체(굵게) + 전체 걸린 시간(흐리게).
      // 폭이 모자라 막대가 MIN_BAR칸보다 짧아지면 시간을 뺀다.
      const count = `${done}/${ls.length}`
      const took = totalTime(ls, w)
      const room = (t: string) => cols - cells(count) - cells(t) - 1
      const tail = took && room(` · ${took}`) >= MIN_BAR ? ` · ${took}` : ''
      const barW = Math.max(0, room(tail))
      // 막대는 다 끝났을 때만 꽉 차고, 하나라도 끝났으면 한 칸은 채운다.
      const part = Math.min(barW - 1, Math.max(done ? 1 : 0, Math.round((barW * done) / ls.length)))
      const fill = !ls.length ? 0 : done === ls.length ? barW : Math.max(0, part)
      body.push(
        <Box key="head" flexDirection="column" marginBottom={1}>
          <Text bold>{cut(b.title, cols)}</Text>
          <Text>
            {fill ? <Text color="success">{'━'.repeat(fill)}</Text> : ''}
            {barW - fill ? <Text color="subtle">{'─'.repeat(barW - fill)}</Text> : ''}
            {' '}
            <Text bold>{count}</Text>
            {tail ? <Text dimColor>{tail}</Text> : ''}
          </Text>
        </Box>,
      )

      // 한 모양(fit)으로 놓을 것과 그 줄 수. 그릴 줄로 세므로 셈과 그림이 어긋나지 않는다.
      const layout = (fit: Fit) => {
        const { ids, moreDone } = compact(ls, fit, b.steps)
        // 놓을 것: 숨긴 끝남, 그리고 목록 차례의 보이는 단계·묶음과 숨긴 예정 덩어리. 이 차례로 세로선 색을 정한다.
        // 묶음은 보이는 아래 단계가 있을 때만, 그 단계들만 그린다(slots).
        const order: { id: string; status: StepStatus; slot?: Slot }[] = []
        if (moreDone) order.push({ id: 'more-done', status: 'done' })
        let more = 0
        for (const sl of slots(b.steps, ids, fit.one)) {
          if (sl.kind === 'more') order.push({ id: `more-todo-${more++}`, status: 'todo', slot: sl })
          else order.push({ id: `step-${sl.step.id}`, status: shown(sl.step).status, slot: sl })
        }
        // 세로선(사용자가 고름, 2026-11-24): 지나온 곳 초록, 지금 묶음은 그 상태 색, 남은 곳 회색.
        // 지금 묶음 = 처음 끝나지 않은 것.
        const open = order.findIndex(o => !isFinal(o.status))
        const nowAt = (i: number) => i === open && isNow(order[i]!.status)
        const railIn = (i: number): Color =>
          open < 0 || i < open ? 'success' : nowAt(i) ? COLOR[order[i]!.status] : 'subtle'
        const railAfter = (i: number): Color => (open < 0 || i + 1 < open || nowAt(i + 1) ? 'success' : 'subtle')
        const blocks = order.map((o, i) => {
          const lines: RenderChildren[] = []
          const sl = o.slot
          if (!sl) lines.push(moreLine('success', `완료 ${moreDone}개 더`))
          else if (sl.kind === 'more') lines.push(moreLine('subtle', `예정 ${sl.steps.length}개 더`))
          else {
            const s = sl.step
            lines.push(row(shown(s), s.label, sl.kind === 'group'))
            if (sl.kind === 'step') lines.push(...hang({ dot: COLOR[s.status] }, s))
            else {
              // 가지 └─ 는 목록 맨 끝 묶음의 마지막 단계에. 그 뒤에 오는 개수 줄은 세로선 없이 들여 쓴다.
              const end = i === order.length - 1 ? sl.kids.map(k => k.kind).lastIndexOf('step') : -1
              sl.kids.forEach((k, j) => {
                if (k.kind === 'more') {
                  lines.push(
                    <Text>
                      {leadOf({ rail: end >= 0 && j > end ? null : railIn(i), dot: 'subtle' })}
                      <Text dimColor>{`예정 ${k.steps.length}개 더`}</Text>
                    </Text>,
                  )
                  return
                }
                const c = k.step
                const last = j === end
                lines.push(row(c, c.label, false, { color: railIn(i), last }))
                lines.push(...hang({ rail: last ? null : railIn(i), dot: COLOR[c.status] }, c))
              })
            }
          }
          // 맨 위 묶음 사이의 빈 줄 대신 세로선 한 줄.
          if (fit.gaps && i < order.length - 1) lines.push(<Text color={railAfter(i)}>│</Text>)
          return { id: o.id, lines }
        })
        const lineCount = blocks.reduce((n, bl) => n + bl.lines.length, 0)
        const rows = HEAD_ROWS + lineCount + (bottom.length ? bottom.length + 1 : 0)
        return { blocks, rows }
      }
      // 패널에 다 들어가는 첫 모양. 무엇으로도 모자라면 가장 짧은 모양.
      const tries = FITS.map(layout)
      const chosen = tries.find(l => l.rows <= e.props.scroll.bodyRows) ?? tries.at(-1)!
      for (const bl of chosen.blocks) {
        body.push(
          <Box key={bl.id} flexDirection="column">
            {bl.lines}
          </Box>,
        )
      }
    }

    if (bottom.length) {
      body.push(
        // 목록 아래면 빈 줄 하나 띄운다. 목록이 없으면 빈 안내의 빈 줄이 그 몫을 한다.
        <Box key="calls" flexDirection="column" {...(b ? { marginTop: 1 } : {})}>
          {bottom}
        </Box>,
      )
    }

    return <Box flexDirection="column">{body}</Box>
  })

  // 입력창 바로 위 띠: 5초 안에 생긴 알림을 색 테두리 상자 하나에 한 줄씩, 새것을 아래에.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [t, all] = await orStop(next.signal, Promise.all([read($, now), read($, alerts)]))
    const live = all.filter(a => t - a.at < ALERT_MS)
    if (live.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const border: Color = live.some(a => a.kind === 'blocked') ? 'warning' : 'success'
    // 테두리 두 칸과 좌우 여백 두 칸을 뺀 폭.
    const room = Math.max(8, e.props.bodyColumns - 4)
    return (
      <Box key="alert" flexDirection="column" borderStyle="round" borderColor={border} paddingX={1}>
        {live.map(a => (
          <Text color={ALERT_COLOR[a.kind]} bold>
            {cut(a.text, room)}
          </Text>
        ))}
      </Box>
    )
  })
}
