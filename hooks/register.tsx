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
// 실행 중 칸에 보이는 호출 줄 수.
const MAX_CALLS = 5
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
type Fit = { todo: number; recent: boolean; gaps: boolean }
const FITS: readonly Fit[] = [
  { todo: 3, recent: true, gaps: true },
  { todo: 2, recent: true, gaps: true },
  { todo: 1, recent: true, gaps: true },
  { todo: 1, recent: false, gaps: true },
  { todo: 0, recent: false, gaps: true },
  { todo: 0, recent: false, gaps: false },
]
// 패널 머리: 제목 1줄 + 막대와 숫자 1줄 + 빈 줄 1줄.
const HEAD_ROWS = 3

function compact(ls: Step[], fit: Fit): { ids: Set<string>; moreDone: number; moreTodo: number } {
  const ids = new Set(ls.filter(s => s.status === 'doing' || s.status === 'blocked').map(s => s.id))
  const fin = ls.filter(s => isFinal(s.status))
  const todo = ls.filter(s => s.status === 'todo')
  // 가장 늦게 끝난 것. 끝난 시각이 같으면 순서상 뒤의 것.
  const last = fin.reduce<Step | undefined>((a, s) => (a && (a.endedAt ?? -1) > (s.endedAt ?? -1) ? a : s), undefined)
  const keep = fit.recent && last ? last : undefined
  if (keep) ids.add(keep.id)
  for (const s of todo.slice(0, fit.todo)) ids.add(s.id)
  return { ids, moreDone: fin.length - (keep ? 1 : 0), moreTodo: Math.max(0, todo.length - fit.todo) }
}

// 화면 폭: 한글·전각은 2칸.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

function cells(text: string): number {
  let n = 0
  for (const ch of text) n += WIDE.test(ch) ? 2 : 1
  return n
}

function cut(text: string, room: number): string {
  if (cells(text) <= room) return text
  if (room <= 1) return room === 1 ? '…' : ''
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = WIDE.test(ch) ? 2 : 1
    if (used + w > room - 1) break
    out += ch
    used += w
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

// 실행 중 칸 한 줄의 글. 파일·검색 도구는 종류와 대상을 따로 두어 같은 종류를 한 줄로 묶는다.
type Label = { label: string; kind?: string; target?: string }

function labelOf(e: { tool: string }): Label {
  const args = e as unknown as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  // "- Read"만으로는 무엇을 보는지 모른다. 종류와 대상(파일 이름, 찾는 말, 주소)을 함께 보인다.
  const of = (kind: string, target: string): Label => (target ? { label: `${kind}: ${target}`, kind, target } : { label: kind })
  const file = (key: string) => str(args[key]).split(/[\\/]+/).filter(Boolean).pop() ?? ''
  // 명령은 Claude가 붙인 짧은 설명을 쓴다. 명령 첫 줄은 경로 때문에 잘려 무엇을 하는지 안 보인다.
  if (e.tool === 'Bash' || e.tool === 'PowerShell') {
    return { label: firstLine(str(args.description)) || shortCommand(str(args.command)) || e.tool }
  }
  if (e.tool === 'Agent') return { label: `에이전트: ${firstLine(str(args.description)) || '작업'}` }
  if (e.tool === 'Monitor') return { label: `모니터: ${firstLine(str(args.description)) || '감시'}` }
  if (e.tool === 'Read') return of('파일 읽기', file('file_path'))
  if (e.tool === 'Edit') return of('파일 수정', file('file_path'))
  if (e.tool === 'Write') return of('파일 작성', file('file_path'))
  if (e.tool === 'NotebookEdit') return of('파일 수정', file('notebook_path'))
  if (e.tool === 'Grep') return of('코드 검색', str(args.pattern) && `"${firstLine(str(args.pattern))}"`)
  if (e.tool === 'Glob') return of('파일 찾기', firstLine(str(args.pattern)))
  if (e.tool === 'WebSearch') return of('웹 검색', firstLine(str(args.query)))
  if (e.tool === 'WebFetch') return of('웹 페이지', /^[a-z]+:\/\/([^/?#]+)/i.exec(str(args.url))?.[1] ?? '')
  if (e.tool === 'Skill') return { label: str(args.skill) ? `스킬: ${str(args.skill)}` : e.tool }
  // MCP 도구는 서버 이름이 길어 잘리므로 도구 이름만 보인다.
  const mcp = /^mcp__(.+?)__(.+)$/.exec(e.tool)
  if (mcp) return { label: mcp[2] ?? e.tool }
  return { label: e.tool }
}

// 같은 종류의 대상들: 폭에 들어가는 만큼 이름을 적고 나머지는 "외 N개".
function fitNames(targets: string[], room: number): string {
  for (let k = targets.length; k >= 1; k--) {
    const more = targets.length - k
    const tail = more ? ` 외 ${more}개` : ''
    const names = targets.slice(0, k).join(', ')
    // 하나도 들어가지 않으면 첫 이름을 잘라서라도 남긴다.
    if (k === 1 || cells(names + tail) <= room) return cut(cut(names, Math.max(1, room - cells(tail))) + tail, room)
  }
  return ''
}

type CallGroup = { label: string; kind?: string; targets: string[]; count: number }

// 같은 종류(파일 읽기 등)는 한 묶음으로. 순서는 그 종류가 처음 시작한 차례.
function groupCalls(visible: Running[]): CallGroup[] {
  const groups: CallGroup[] = []
  for (const c of visible) {
    const same = c.kind && c.target ? groups.find(g => g.kind === c.kind) : undefined
    if (same && c.target) {
      if (!same.targets.includes(c.target)) same.targets.push(c.target)
      same.count += 1
    } else groups.push({ label: c.label, kind: c.kind, targets: c.target ? [c.target] : [], count: 1 })
  }
  return groups
}

// 돌고 있는 명령을 붙일 단계: 진행 중인 아래 단계 가운데 가장 나중에 시작한 것. 없으면 맨 아래에 둔다.
function callsAt(ls: Step[]): string | undefined {
  let at: Step | undefined
  for (const s of ls) {
    if (s.status === 'doing' && (!at || (s.startedAt ?? 0) > (at.startedAt ?? 0))) at = s
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
    }
    if (status === 'doing' && step.startedAt === undefined) step.startedAt = t
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
        fresh.push({ kind: 'done', text: `✓ ${step.label} 완료${took ? ` (${took} 걸림)` : ''}` })
      } else if (status === 'blocked') {
        fresh.push({ kind: 'blocked', text: `⚠ ${step.label}에서 막힘${note ? `: ${note}` : ''}` })
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const b = await read($, board)
    const calls = await read($, running)
    const t = await read($, now)
    // 단계 시간은 일한 시각으로, 돌고 있는 명령은 벽시계로.
    const w = workTime(b, t)
    const cols = Math.max(16, e.props.bodyColumns)

    // 단계 아래에 붙는 줄의 앞부분: 묶음 안이면 세로선, 그리고 점선. 글자는 단계 이름과 같은 칸에서 시작한다.
    type Lead = { rail?: Color; dot: Color }
    const leadOf = (l: Lead): RenderChildren[] => [
      ...(l.rail ? [<Text color={l.rail}>│</Text>, ' '] : []),
      <Text color={l.dot}>┆</Text>,
      ' ',
    ]
    const leadCells = (l: Lead) => (l.rail ? 4 : 2)

    // 한 줄: [세로선] 표시(상태 색) + 이름(상태별 강조) + 오른쪽 끝 시간.
    const row = (st: Shown, label: string, isGroup: boolean, rail?: Color) => {
      const head = rail ? 4 : 2
      const right = timeText(st, w)
      const room = cols - head - (right ? cells(right) + 1 : 0)
      const name = cut(label, room)
      const gap = right ? ' '.repeat(Math.max(1, cols - head - cells(name) - cells(right))) : ''
      // 묶음 이름은 기본 색 굵게(주황은 진행 중인 단계 이름에만). 끝났거나 건너뛴 묶음은 끝난 단계처럼 물러난다.
      const ls: Style = isGroup ? (isFinal(st.status) ? { dimColor: true } : { bold: true }) : LABEL[st.status]
      const ts = TIME[st.status]
      return (
        <Text>
          {rail ? <Text color={rail}>│</Text> : ''}
          {rail ? ' ' : ''}
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

    // 명령 줄들: 다섯 줄까지, 넘으면 "외 n개". 종류("파일 읽기:")는 흐리게, 대상은 보통.
    const callLines = (l: Lead, groups: CallGroup[]): RenderChildren[] => {
      const room = cols - leadCells(l)
      const out: RenderChildren[] = groups.slice(0, MAX_CALLS).map(g => {
        if (!g.kind) return <Text>{leadOf(l)}{cut(g.label, room)}</Text>
        const kind = `${g.kind}:`
        return (
          <Text>
            {leadOf(l)}
            <Text dimColor>{kind}</Text>
            {` ${fitNames(g.targets, room - cells(kind) - 1)}`}
          </Text>
        )
      })
      const hidden = groups.slice(MAX_CALLS).reduce((n, g) => n + g.count, 0)
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
    const groups = groupCalls(calls.filter(c => t - c.startedAt >= SHOW_AFTER_MS))
    const at = b ? callsAt(leaves(b.steps)) : undefined

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
      if (step.id === at) out.push(...callLines(l, groups))
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

    const bottom = groups.length && !at ? callLines({ dot: 'subtle' }, groups) : []

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
      const count = `${done}/${ls.length}`
      const took = totalTime(ls, w)
      const tail = took ? ` · ${took}` : ''
      const barW = Math.max(0, cols - cells(count) - cells(tail) - 1)
      const fill = ls.length ? Math.round((barW * done) / ls.length) : 0
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
        const { ids, moreDone, moreTodo } = compact(ls, fit)
        // 놓을 것: 숨긴 끝남, 보이는 단계 묶음들, 숨긴 예정. 이 차례로 세로선 색을 정한다.
        const order: { id: string; status: StepStatus; step?: Step; kids: Step[] }[] = []
        if (moreDone) order.push({ id: 'more-done', status: 'done', kids: [] })
        for (const s of b.steps) {
          const kids = s.children ?? []
          const seen = kids.filter(c => ids.has(c.id))
          // 묶음은 보이는 아래 단계가 있을 때만, 그 단계들만 그린다.
          if (kids.length ? seen.length === 0 : !ids.has(s.id)) continue
          order.push({ id: `step-${s.id}`, status: shown(s).status, step: s, kids: seen })
        }
        if (moreTodo) order.push({ id: 'more-todo', status: 'todo', kids: [] })
        // 세로선(사용자가 고름, 2026-11-24): 지나온 곳 초록, 지금 묶음은 그 상태 색, 남은 곳 회색.
        // 지금 묶음 = 처음 끝나지 않은 것.
        const open = order.findIndex(o => !isFinal(o.status))
        const nowAt = (i: number) => i === open && isNow(order[i]!.status)
        const railIn = (i: number): Color =>
          open < 0 || i < open ? 'success' : nowAt(i) ? COLOR[order[i]!.status] : 'subtle'
        const railAfter = (i: number): Color => (open < 0 || i + 1 < open || nowAt(i + 1) ? 'success' : 'subtle')
        const blocks = order.map((o, i) => {
          const lines: RenderChildren[] = []
          if (o.id === 'more-done') lines.push(moreLine('success', `완료 ${moreDone}개 더`))
          else if (o.id === 'more-todo') lines.push(moreLine('subtle', `예정 ${moreTodo}개 더`))
          else if (o.step) {
            const s = o.step
            lines.push(row(shown(s), s.label, o.kids.length > 0))
            if (!o.kids.length) lines.push(...hang({ dot: COLOR[s.status] }, s))
            for (const c of o.kids) {
              lines.push(row(c, c.label, false, railIn(i)))
              lines.push(...hang({ rail: railIn(i), dot: COLOR[c.status] }, c))
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
    const t = await read($, now)
    const live = (await read($, alerts)).filter(a => t - a.at < ALERT_MS)
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
