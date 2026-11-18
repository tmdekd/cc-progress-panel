import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'

import type { Board, BoardEntry } from '../types'

const TOOL = 'mcp__progress-panel__progress'
const ROOT = 'C:\\Users\\me\\Proj'
const ROOT_KEY = 'c:/users/me/proj'
const T0 = Date.UTC(2026, 10, 18, 1, 0, 0)
const SEC = 1000
const MIN = 60 * SEC

// 이 mod 의 도구는 아직 타입에 없어서 입력을 넓게 받는다.
type CallInput = Parameters<EngineInterface['tool']['call']>[0]
const tool = (args: Record<string, unknown>) => ({ tool: TOOL, ...args }) as unknown as CallInput
const COMPOSER = { wait: false, origin: { kind: 'composer' } } as const
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const PLAN = {
  action: 'plan',
  title: '동네 빵집 홈페이지 만들기',
  steps: [
    { id: 'a', label: '사진 모으기' },
    {
      id: 'b',
      label: '화면',
      children: [
        { id: 'b1', label: '메뉴 화면' },
        { id: 'b2', label: '주문 화면' },
      ],
    },
    { id: 'c', label: '공개하기' },
  ],
}

const SURFACES = ['terminal', 'desktop'] as const

function pane(surface: 'terminal' | 'desktop', bodyColumns = 40) {
  return {
    plugin: 'progress-panel',
    surface,
    component: 'Pane',
    requestId: 'progress',
    props: {
      title: '진행 상황',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  } as const
}

// 입력창 바로 위 띠. 알림 상자가 여기에 그려진다.
function band(surface: 'terminal' | 'desktop', o: { hasSurvey?: boolean; bodyColumns?: number } = {}) {
  return {
    plugin: 'progress-panel',
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey: o.hasSurvey ?? false,
      isCollapsed: false,
      isWorking: true,
      maxRows: 20,
      bodyColumns: o.bodyColumns ?? 100,
      scroll: { offset: 0, bodyRows: 19 },
      view: {},
    },
  } as const
}

function savedBoard(title: string, done: boolean): Board {
  const status = done ? 'done' : 'todo'
  return {
    title,
    updatedAt: T0 - 20 * MIN,
    steps: [
      { id: 'x', label: '첫 단계', status: 'done' },
      { id: 'y', label: '둘째 단계', status },
    ],
  }
}

function entry(sessionId: string, lastSeen: number, board: Board, root = ROOT_KEY): BoardEntry {
  return { root, sessionId, lastSeen, board }
}

// 엔진 자리에 서는 훅들: 세션 id·루트, 저장소, 시계, 패널 열기·닫기, 토스트.
function world(on: On, o: { sessionId?: string; store?: Record<string, unknown> } = {}) {
  const store = new Map<string, unknown>(Object.entries(o.store ?? {}))
  const toasts: string[] = []
  const opened: string[] = []
  const clock = mock.clock(on, { now: T0 })

  on('session.id', () => ({ value: o.sessionId ?? 'S1' }))
  on('session.root', () => ({ value: ROOT }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__progress-panel__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  return { store, toasts, opened, clock }
}

const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const

// 화면 폭: 한글·전각은 2칸.
function cells(text: string): number {
  let n = 0
  for (const ch of text) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1
  return n
}

test('plan draws every step with its mark and the count, on terminal and desktop', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))

  expect(w.opened).toContain('progress')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ type: 'Text', text: /동네 빵집 홈페이지 만들기/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ 사진 모으기/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /· 화면/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /· 메뉴 화면/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0\/4 단계/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a finished step shows how long it took and raises a green box above the prompt', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(42 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /✓ 사진 모으기.*42분/ })).toBeDefined()
  await ui.unmount()

  for (const surface of SURFACES) {
    const b = await $.ui.mount(band(surface))
    expect(await b.find({ type: 'Text', text: /^✓ 사진 모으기 끝 \(42분\)$/ })).toBeDefined()
    const box = await b.find({ type: 'Box', key: 'alert' })
    expect(box?.props.borderStyle).toBe('round')
    expect(box?.props.borderColor).toBe('success')
    await b.unmount()
  }
  // 눈에 잘 안 띄는 기본 알림창은 더 쓰지 않는다.
  expect(w.toasts).toEqual([])
})

test('the box above the prompt goes after 5 seconds', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))

  await w.clock.advance(4 * SEC)
  let b = await $.ui.mount(band('terminal'))
  expect(await b.find({ type: 'Text', text: /사진 모으기 끝/ })).toBeDefined()
  await b.unmount()

  await w.clock.advance(2 * SEC)
  b = await $.ui.mount(band('terminal'))
  expect(await b.find({ type: 'Text', text: /사진 모으기 끝/ })).toBeUndefined()
  expect(await b.find({ type: 'Box', key: 'alert' })).toBeUndefined()
  await b.unmount()
})

test('several alerts share one box, newest last, each going on its own time', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await w.clock.advance(3 * SEC)
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'done' }))

  let b = await $.ui.mount(band('terminal'))
  const lines = await b.findAll({ type: 'Text', text: /끝/ })
  expect(lines.map(l => l.text)).toEqual(['✓ 사진 모으기 끝', '✓ 메뉴 화면 끝'])
  await b.unmount()

  await w.clock.advance(3 * SEC)
  b = await $.ui.mount(band('terminal'))
  expect(await b.find({ type: 'Text', text: /사진 모으기 끝/ })).toBeUndefined()
  expect(await b.find({ type: 'Text', text: /메뉴 화면 끝/ })).toBeDefined()
  await b.unmount()
})

test('a survey above the prompt keeps the box away', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))

  const b = await $.ui.mount(band('terminal', { hasSurvey: true }))
  expect(await b.find({ type: 'Box', key: 'alert' })).toBeUndefined()
  await b.unmount()
})

test('a long alert is cut to the width above the prompt', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'blocked', note: '아주 '.repeat(40) }))

  const b = await $.ui.mount(band('terminal', { bodyColumns: 40 }))
  const line = await b.find({ type: 'Text', text: /공개하기 막힘/ })
  // 테두리 두 칸과 좌우 여백 두 칸을 뺀 폭.
  expect(cells(line?.text ?? '')).toBeLessThanOrEqual(36)
  expect(line?.text.endsWith('…')).toBe(true)
  await b.unmount()
})

test('a step in progress shows its time so far', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(17 * MIN)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /▶ 사진 모으기.*17분째/ })).toBeDefined()
  await ui.unmount()
})

test('the count is of the lowest steps', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'done' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /2\/4 단계/ })).toBeDefined()
  await ui.unmount()
})

test('a group follows the steps under it', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b2', status: 'doing' }))

  let ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /▶ 화면/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call(tool({ action: 'update', id: 'b2', status: 'done' }))
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /✓ 화면/ })).toBeDefined()
  await ui.unmount()
})

test('a blocked step shows its reason and raises a yellow box above the prompt', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'blocked', note: '도메인 연결 안 됨' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /⚠ 공개하기/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /도메인 연결 안 됨/ })).toBeDefined()
  await ui.unmount()

  const b = await $.ui.mount(band('terminal'))
  const line = await b.find({ type: 'Text', text: /^⚠ 공개하기 막힘: 도메인 연결 안 됨$/ })
  expect(line?.props.color).toBe('warning')
  expect((await b.find({ type: 'Box', key: 'alert' }))?.props.borderColor).toBe('warning')
  await b.unmount()
})

test('finishing the last step says that all are done', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  for (const id of ['a', 'b1', 'b2']) {
    await $.tool.call(tool({ action: 'update', id, status: 'done' }))
  }
  let b = await $.ui.mount(band('terminal'))
  expect(await b.find({ type: 'Text', text: /모든 단계 끝/ })).toBeUndefined()
  await b.unmount()

  await $.tool.call(tool({ action: 'update', id: 'c', status: 'skipped' }))
  b = await $.ui.mount(band('terminal'))
  const all = await b.find({ type: 'Text', text: /^✓ 모든 단계 끝$/ })
  expect(all?.props.bold).toBe(true)
  await b.unmount()
})

// 다시 불러온 직후 session.start 보다 먼저 도구가 불려도 목록이 저장된다.
test('a list written before the session has started is still saved', async ($, on) => {
  const w = world(on)
  await $.tool.call(tool(PLAN))

  const saved = w.store.get(`board:${ROOT_KEY}:S1`) as BoardEntry | undefined
  expect(saved?.board.title).toBe('동네 빵집 홈페이지 만들기')
})

// 다시 불러오면 session.start 가 또 돈다. 이 세션이 이미 그리고 있는 목록을 저장소의 옛 목록으로 덮지 않는다.
test('a reload keeps the list the session already has over an older saved one', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  w.store.set(`board:${ROOT_KEY}:S1`, entry('S1', T0, savedBoard('옛 목록', false)))

  await $.session.start(START)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /동네 빵집 홈페이지 만들기/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /옛 목록/ })).toBeUndefined()
  await ui.unmount()
  const saved = w.store.get(`board:${ROOT_KEY}:S1`) as BoardEntry | undefined
  expect(saved?.board.title).toBe('동네 빵집 홈페이지 만들기')
})

// 같은 프로그램 안에서 세션이 바뀌면(/clear 등) 앞 세션이 그리던 목록을 들고 가지 않는다.
test('a new session does not carry the list the last one was drawing', async ($, on) => {
  const ids = { sessionId: 'S1' }
  world(on, ids)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  ids.sessionId = 'S2'
  await $.session.start(START)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /동네 빵집 홈페이지 만들기/ })).toBeUndefined()
  await ui.unmount()
})

test('planning the same work again keeps what was done', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(5 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ ...PLAN, steps: [...PLAN.steps, { id: 'd', label: '문서' }] }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /✓ 사진 모으기.*5분/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\/5 단계/ })).toBeDefined()
  await ui.unmount()
})

// 다른 일(제목이 다름)의 단계가 우연히 같은 id 를 써도 지난 상태를 물려받지 않는다.
test('a new piece of work starts fresh even where ids repeat', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'plan', title: '다른 일', steps: [{ id: 'a', label: '시작' }, { id: 'z', label: '끝내기' }] }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /· 시작/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0\/2 단계/ })).toBeDefined()
  await ui.unmount()
})

test('an unknown step id is refused', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  const r = await $.tool.call(tool({ action: 'update', id: 'zz', status: 'done' }))

  expect(r.deny).toMatch(/zz/)
})

test('a subagent may not write the list', async ($, on) => {
  world(on)
  await $.session.start(START)
  const r = await $.tool.call(tool({ ...PLAN, agentId: 'a1' }))

  expect(r.deny).toMatch(/서브 에이전트/)
})

test('the tool answers with the list so Claude can read the ids', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  const r = await $.tool.call(tool({ action: 'show' }))

  expect(String(r.result)).toMatch(/동네 빵집 홈페이지 만들기/)
  expect(String(r.result)).toMatch(/b1/)
})

test('clear empties the panel and the saved list', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  expect(w.store.has(`board:${ROOT_KEY}:S1`)).toBe(true)
  await $.tool.call(tool({ action: 'clear' }))

  expect(w.store.has(`board:${ROOT_KEY}:S1`)).toBe(false)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /진행 중인 단계가 없습니다/ })).toBeDefined()
  await ui.unmount()
})

test('/progress clear does the same', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.command.run({ command: 'progress', args: 'clear', ...TYPED })

  expect(w.store.has(`board:${ROOT_KEY}:S1`)).toBe(false)
})

test('/progress opens the pane', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.command.run({ command: 'progress', args: '', ...TYPED })

  expect(w.opened).toContain('progress')
})

test('this session\'s saved list comes back and opens the pane', async ($, on) => {
  const w = world(on, {
    store: { [`board:${ROOT_KEY}:S1`]: entry('S1', T0 - 30 * MIN, savedBoard('지난 작업', false)) },
  })
  await $.session.start(START)

  expect(w.opened).toContain('progress')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /지난 작업/ })).toBeDefined()
  await ui.unmount()
})

test('the list of a closed window is taken over', async ($, on) => {
  const w = world(on, {
    sessionId: 'S2',
    store: { [`board:${ROOT_KEY}:OLD`]: entry('OLD', T0 - 10 * MIN, savedBoard('지난 작업', false)) },
  })
  await $.session.start(START)

  expect(w.store.has(`board:${ROOT_KEY}:S2`)).toBe(true)
  expect(w.store.has(`board:${ROOT_KEY}:OLD`)).toBe(false)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /지난 작업/ })).toBeDefined()
  await ui.unmount()
})

test('the list of a window still open is left alone', async ($, on) => {
  const w = world(on, {
    sessionId: 'S2',
    store: { [`board:${ROOT_KEY}:OLD`]: entry('OLD', T0 - 30 * SEC, savedBoard('다른 창 작업', false)) },
  })
  await $.session.start(START)

  expect(w.store.has(`board:${ROOT_KEY}:OLD`)).toBe(true)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /다른 창 작업/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /진행 중인 단계가 없습니다/ })).toBeDefined()
  await ui.unmount()
})

test('another folder\'s list is not shown', async ($, on) => {
  world(on, {
    sessionId: 'S2',
    store: { 'board:c:/other:OLD': entry('OLD', T0 - 60 * MIN, savedBoard('다른 폴더', false), 'c:/other') },
  })
  await $.session.start(START)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /다른 폴더/ })).toBeUndefined()
  await ui.unmount()
})

test('a finished list comes back without opening the pane', async ($, on) => {
  const w = world(on, {
    store: { [`board:${ROOT_KEY}:S1`]: entry('S1', T0 - 30 * MIN, savedBoard('끝난 작업', true)) },
  })
  await $.session.start(START)

  expect(w.opened).not.toContain('progress')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /끝난 작업/ })).toBeDefined()
  await ui.unmount()
})

test('the window that holds a list keeps saying it is open', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await w.clock.advance(5 * MIN)

  const saved = w.store.get(`board:${ROOT_KEY}:S1`) as BoardEntry
  expect(saved.lastSeen).toBeGreaterThanOrEqual(T0 + 4 * MIN)
})

test('the first prompt after taking over a list tells Claude, once', async ($, on) => {
  world(on, {
    sessionId: 'S2',
    store: { [`board:${ROOT_KEY}:OLD`]: entry('OLD', T0 - 10 * MIN, savedBoard('지난 작업', false)) },
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  await $.session.start(START)

  const first = await $.prompt.submit({ text: '이어서 하자', ...COMPOSER })
  expect((first.context ?? []).join('\n')).toMatch(/\[진행 상황 패널\].*지난 작업/s)
  const second = await $.prompt.submit({ text: '다음', ...COMPOSER })
  expect((second.context ?? []).join('\n')).not.toMatch(/진행 상황 패널/)
})

// 아래 칸은 "- 하는 일" 목록만: 머리말("실행 중:")과 걸린 시간은 없다.
test('the running command shows as a plain list item, and then goes', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const call = $.tool.call({ tool: 'Bash', command: 'pytest test/db\necho done' })
  await w.clock.settle()
  await w.clock.advance(2500)

  let ui = await $.ui.mount(pane('terminal'))
  const line = await ui.find({ type: 'Text', text: /pytest test\/db/ })
  expect(line?.text).toBe('- pytest test/db')
  expect(await ui.find({ type: 'Text', text: /실행 중|초$/ })).toBeUndefined()
  await ui.unmount()

  await w.clock.advance(5 * SEC)
  await call
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /pytest/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /대기 중/ })).toBeDefined()
  await ui.unmount()
})

// 경로가 긴 명령은 잘려서 무엇을 하는지 안 보인다. Claude가 적은 짧은 설명을 대신 보여 준다.
test('a command shows the short description Claude gave it', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const call = $.tool.call({
    tool: 'Bash',
    command: 'cd "C:/Users/me/.claude/dev-mods/abc/progress-panel" && claude plugin test . 2>&1 | tail -4',
    description: '플러그인 테스트 실행',
  })
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  const line = await ui.find({ type: 'Text', text: /플러그인/ })
  expect(line?.text).toBe('- 플러그인 테스트 실행')
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await call
})

// 설명이 없으면 앞의 "cd 경로 &&"를 떼고, 첫 명령만(뒤의 |·&&·;·출력 돌리기 없이), 절대 경로는 마지막 이름만 남긴다.
test('without a description the command is shortened', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const call = $.tool.call({
    tool: 'Bash',
    command: 'cd "C:/Users/me/Proj" && pytest C:/Users/me/Proj/tests/test_db.py 2>/dev/null',
  })
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal', 60))
  const line = await ui.find({ type: 'Text', text: /pytest/ })
  expect(line?.text).toBe('- pytest test_db.py')
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await call
})

test('a shortened command keeps only its first command', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const examples: [string, string][] = [
    ['cd "C:/a/b" && claude plugin validate C:/Users/me/progress-panel 2>&1 | tail -1', '- claude plugin validate progress-panel'],
    ['npm run build && npm test', '- npm run build'],
    ['Start-Sleep -Seconds 8; "ok"', '- Start-Sleep -Seconds 8'],
    ['grep -n "a|b" file.txt > out.txt', '- grep -n "a|b" file.txt'],
  ]
  for (const [command, shown] of examples) {
    const call = $.tool.call({ tool: 'Bash', command })
    await w.clock.settle()
    await w.clock.advance(2500)
    const ui = await $.ui.mount(pane('terminal', 60))
    expect((await ui.find({ type: 'Text', text: /^- / }))?.text).toBe(shown)
    await ui.unmount()
    await w.clock.advance(5 * SEC)
    await call
  }
})

test('a subagent\'s commands are left out', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const call = $.tool.call({ tool: 'Bash', command: 'make', agentId: 'a1' })
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /make/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /대기 중/ })).toBeDefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await call
})

// 백그라운드 명령도 같은 "- 하는 일" 모양이다.
test('a background command is listed the same way', async ($, on) => {
  const w = world(on)
  // 백그라운드로 띄운 명령은 바로 돌아오고, 끝은 나중에 알림으로 온다.
  on('tool.call', { tool: 'Bash' }, () => ({ result: { backgroundTaskId: 't1' } }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'docker compose up', description: '도커 컨테이너 시작', run_in_background: true })
  await w.clock.advance(2 * SEC)

  const ui = await $.ui.mount(pane('terminal'))
  const line = await ui.find({ type: 'Text', text: /도커/ })
  expect(line?.text).toBe('- 도커 컨테이너 시작')
  expect(await ui.find({ type: 'Text', text: /백그라운드/ })).toBeUndefined()
  await ui.unmount()
})

test('a long label is cut to the pane width', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '짧은 제목',
      steps: [{ id: 'a', label: '아주 긴 한국어 단계 이름입니다 정말로 아주 깁니다' }],
    }),
  )

  const ui = await $.ui.mount(pane('terminal', 24))
  const row = await ui.find({ type: 'Text', text: /· 아주/ })
  expect(row).toBeDefined()
  expect(cells(row?.text ?? '')).toBeLessThanOrEqual(24)
  expect(row?.text).toMatch(/…/)
  await ui.unmount()
})

test('the rules are added to the system prompt, last', async ($, on) => {
  world(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: '시작', scope: 'shared' }] }))
  await $.session.start(START)
  const r = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [TOOL],
    outputStyle: null,
    traits: [],
  })
  const last = r.sections[r.sections.length - 1]

  expect(last?.id).toBe('progress-panel:rules')
  expect(last?.scope).toBe('session')
  expect(last?.text).toMatch(/mcp__progress-panel__progress/)
  // 누가 어떤 일을 하든: 할 예정·하는 중·끝남·막힘을 알리고, 일의 종류를 가리지 않는다.
  expect(last?.text).toMatch(/할 예정/)
  expect(last?.text).toMatch(/종류와 상관없이/)
  // 하는 도중 할 일이 바뀌면 같은 제목으로 다시 적어 패널을 실제 진행에 맞춘다.
  expect(last?.text).toMatch(/같은 title로 다시 "plan"/)
  // 패널의 실행 중 줄이 읽히도록 명령 설명을 사용자가 쓰는 언어로 짧게 적게 한다(특정 언어로 못 박지 않는다).
  expect(last?.text).toMatch(/description.*사용자가 쓰는 언어/)
  expect(last?.text).not.toMatch(/한국어/)
})

// ── 가독성: 상태마다 색, 단계 사이 빈 줄 ─────────────────

test('the step in progress stands out in the accent color, on terminal and desktop', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const label = await ui.find({ type: 'Text', text: /^사진 모으기$/ })
    expect(label?.props.color).toBe('claude')
    expect(label?.props.bold).toBe(true)
    await ui.unmount()
  }
})

test('a finished step recedes and its mark is green', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^사진 모으기$/ }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^✓$/ }))?.props.color).toBe('success')
  await ui.unmount()
})

test('a blocked step and its reason are in the warning color', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'blocked', note: '도메인 연결 안 됨' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^공개하기$/ }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: /도메인 연결 안 됨/ }))?.props.color).toBe('warning')
  await ui.unmount()
})

test('a skipped step is struck through', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'skipped' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^공개하기$/ }))?.props.strikethrough).toBe(true)
  await ui.unmount()
})

test('a group\'s name is bold', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^화면$/ }))?.props.bold).toBe(true)
  await ui.unmount()
})

// 마지막 단계 묶음의 빈 줄이 실행 중 칸과의 간격도 맡는다(빈 줄 두 개가 되지 않게).
test('top-level steps are set apart by a blank row, and the head too', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))

  const ui = await $.ui.mount(pane('terminal'))
  for (const id of ['a', 'b', 'c']) {
    expect((await ui.find({ type: 'Box', key: `step-${id}` }))?.props.marginBottom).toBe(1)
  }
  expect((await ui.find({ type: 'Box', key: 'head' }))?.props.marginBottom).toBe(1)
  expect((await ui.find({ type: 'Box', key: 'calls' }))?.props.marginTop).toBeUndefined()
  await ui.unmount()
})

test('the empty panel keeps a blank row before the running part', async ($, on) => {
  world(on)
  await $.session.start(START)

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Box', key: 'empty' }))?.props.marginBottom).toBe(1)
  await ui.unmount()
})

test('the list mark of a running command is in its own color', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const call = $.tool.call({ tool: 'Bash', command: 'pytest test/db' })
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^-$/ }))?.props.color).toBe('suggestion')
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await call
})
