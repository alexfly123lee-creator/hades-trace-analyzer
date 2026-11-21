/**
 * Step naming (SPEC F23.1): "verb + object" titles, action chips and marks.
 * The raw caption stays on the projection and becomes the row's tooltip.
 */
import { fileBase, truncateText } from './trace.js';

// The ONE tool verb table: the *title-word* form of each tool, used for both the
// fallback title and the chips, so one tool can never show two chip names.
const TOOL_VERB = {
  read: '读取', read_image: '看图', edit: '修改', write: '写', grep: '搜', glob: '找',
  pwsh: '运行', present: '交付', plugin_manager: '插件', skill: '技能', todo_write: '清单',
  ask_user_question: '提问', web_search: '搜网', web_fetch: '抓', cordis_inspect_query: '查',
  cordis_inspect_list: '查', exit_plan_mode: '提交计划', load_workspace_dependencies: '取运行环境',
  subagent: '派发', subagent_fork: '派发', create_goal: '建目标', get_goal: '读目标',
  update_goal: '目标', schedule_create: '定时', schedule_list: '看定时', update_plan: '计划',
};

const NOTE_PRIORITY = {
  fail: 0, retry: 1, compact: 2, deliver: 3, command: 4, workspace: 5,
  plan: 6, todo: 7, approval: 8, inject: 9,
};

function clipLine(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** First real command line of a shell script (drops leading VAR=… statements). */
function cmdHead(command) {
  const lines = String(command ?? '').replace(/\r/g, '').split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const isAssignment = (line) => /^\$?[\w-]+\s*=/.test(line);
  const line = lines.find((candidate) => !isAssignment(candidate)) ?? '';
  return line.replace(/\s+/g, ' ').trim();
}

function urlLabel(value) {
  try {
    const url = new URL(String(value));
    return url.pathname && url.pathname !== '/' ? fileBase(url.pathname) : url.host;
  } catch {
    return clipLine(value, 24);
  }
}

/** First string of a top-level array of strings (e.g. `web_search.queries`). */
function argFirstArrayString(text, key) {
  const raw = String(text ?? '');
  const at = raw.indexOf('"' + key + '"');
  if (at < 0) return null;
  const start = raw.indexOf('[', at);
  if (start < 0) return null;
  const open = raw.indexOf('"', start);
  if (open < 0) return null;
  let out = '';
  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') { out += raw[i + 1] ?? ''; i += 1; continue; }
    if (ch === '"') return out;
    out += ch;
  }
  return out;
}

/**
 * Read one top-level field out of an arguments JSON text *without parsing it*:
 * leaves keep only a 400-char head, which JSON.parse rejects on write/edit
 * calls; these scanners walk the head and tolerate truncation.
 */
function argString(text, key) {
  const raw = String(text ?? '');
  const at = raw.indexOf('"' + key + '"');
  if (at < 0) return null;
  let i = raw.indexOf(':', at + key.length + 2);
  if (i < 0) return null;
  i += 1;
  while (i < raw.length && raw[i] !== '"') {
    if (!/\s/.test(raw[i])) return null; // not a string value
    i += 1;
  }
  if (i >= raw.length) return null;
  i += 1;
  let out = '';
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\') {
      const next = raw[i + 1];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next ?? '';
      i += 2;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
    i += 1;
  }
  return out; // truncated head: use what we have
}

function argNumber(text, key) {
  const raw = String(text ?? '');
  const at = raw.indexOf('"' + key + '"');
  if (at < 0) return null;
  const i = raw.indexOf(':', at + key.length + 2);
  if (i < 0) return null;
  const match = /^\s*(-?\d+(?:\.\d+)?)/.exec(raw.slice(i + 1, i + 32));
  return match ? Number(match[1]) : null;
}

/** Length of a top-level array of objects (files / todos / questions). */
function argArrayLength(text, key) {
  const raw = String(text ?? '');
  const at = raw.indexOf('"' + key + '"');
  if (at < 0) return 0;
  const start = raw.indexOf('[', at);
  if (start < 0) return 0;
  let depth = 0;
  let count = 0;
  for (let i = start + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      i += 1;
      while (i < raw.length && raw[i] !== '"') { if (raw[i] === '\\') i += 1; i += 1; }
      continue;
    }
    if (ch === '{') {
      if (depth === 0) count += 1;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
    } else if (ch === ']' && depth <= 0) {
      return count;
    }
  }
  return count;
}

/** "读取 client.js:226" — the object is the first named field, never raw JSON. */
export function toolTitle(name, argsText) {
  const text = String(argsText ?? '');
  const str = (key) => argString(text, key);
  const file = str('file_path') ?? str('path') ?? str('filename') ?? str('file');
  const verb = TOOL_VERB[name];
  switch (name) {
    case 'read': {
      if (!file) return '读取文件';
      // DSH spills oversized output to dsh-spill-*/<uuid>-<tool>.txt names.
      if (/[\\/]dsh-spill[^\\/]*[\\/]/.test(file)) return '读取 工具输出';
      const base = fileBase(file);
      const clipped = clipLine(base, 26);
      // A clipped name keeps no line number: `…cordis_inspe…:1720` is noise.
      const offset = argNumber(text, 'offset');
      const at = offset != null && offset > 0 && clipped === base ? ':' + offset : '';
      return `读取 ${clipped}${at}`;
    }
    case 'read_image': return file ? `看图 ${clipLine(fileBase(file), 26)}` : '看图';
    case 'edit': return file ? `修改 ${clipLine(fileBase(file), 26)}` : '修改文件';
    case 'write': return file ? `写 ${clipLine(fileBase(file), 26)}` : '写文件';
    case 'grep': {
      const pattern = clipLine(str('pattern'), 20);
      return pattern ? `搜 「${pattern}」` : '搜索';
    }
    case 'glob': {
      const pattern = str('pattern');
      return pattern ? `找 ${clipLine(pattern, 26)}` : '找文件';
    }
    case 'pwsh': {
      const desc = clipLine(str('description'), 34);
      if (desc) return `运行 · ${desc}`;
      const head = cmdHead(str('command'));
      return head ? `运行 · ${clipLine(head, 30)}` : '运行命令';
    }
    case 'present': {
      const n = argArrayLength(text, 'files');
      return n > 1 ? `交付 ${n} 个文件` : '交付文件';
    }
    case 'plugin_manager': {
      const action = str('action');
      return action ? `插件 ${action}` : '插件管理';
    }
    case 'skill': {
      const skill = str('name');
      return skill ? `技能 ${clipLine(skill, 24)}` : '加载技能';
    }
    case 'todo_write': {
      const n = argArrayLength(text, 'todos');
      return n > 0 ? `清单 ${n} 项` : '更新清单';
    }
    case 'ask_user_question': {
      const n = argArrayLength(text, 'questions');
      return n > 0 ? `提问 ${n} 问` : '提问';
    }
    case 'web_search': return `搜网 ${clipLine(argFirstArrayString(text, 'queries'), 22)}`;
    case 'web_fetch': {
      const url = str('url');
      return url ? `抓 ${urlLabel(url)}` : '抓网页';
    }
    case 'cordis_inspect_query': {
      const method = str('method');
      return method ? `查 ${clipLine(method, 22)}` : '查运行时';
    }
    case 'cordis_inspect_list': return '查运行时清单';
    default:
      // exit_plan_mode / load_workspace_dependencies are exactly their chip
      // words here (`提交计划` / `取运行环境`).
      if (verb) return verb;
      return name ? `tool · ${name}` : 'tool';
  }
}

/** First sentence, markdown stripped; never cuts inside an unclosed bracket. */
function firstSentence(text) {
  const flat = truncateText(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/[>*#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';
  let cut = flat;
  const match = flat.match(/^(.{0,60}?[。！？；!?;])/);
  if (match) cut = match[1];
  if (cut.length > 42) {
    const head = cut.slice(0, 42);
    const open = Math.max(head.lastIndexOf('（'), head.lastIndexOf('('));
    const close = Math.max(head.lastIndexOf('）'), head.lastIndexOf(')'));
    let at = Math.max(head.lastIndexOf('，'), head.lastIndexOf('、'), head.lastIndexOf('；'), head.lastIndexOf('：'), head.lastIndexOf(' '));
    if (open > close && open > 12) at = open;
    if (at < 14) at = 41;
    cut = head.slice(0, at).replace(/[，、；：\s]+$/, '') + '…';
  }
  return cut;
}

const MAX_STEP_CHIPS = 3;

// Fallback titles collapse into a short chip so the row does not repeat a word.
const LEAD_TAG = {
  运行命令: '运行', 写文件: '写', 读取文件: '读取', 修改文件: '修改', 找文件: '找',
  交付文件: '交付', 查运行时: '查', 查运行时清单: '查', 抓网页: '抓', 搜索: '搜',
};

const leadTag = (value) => {
  const word = String(value).split(' ')[0];
  if (word === 'tool') return '工具';
  return LEAD_TAG[word] ?? word;
};

/** Distinct actions of one step, in first-call order (F137). */
function actionChips(calls) {
  const order = [];
  const counts = new Map();
  for (const call of calls) {
    const verb = TOOL_VERB[call.toolName] ?? '工具';
    if (!counts.has(verb)) {
      counts.set(verb, 0);
      order.push(verb);
    }
    counts.set(verb, counts.get(verb) + 1);
  }
  return order.map((verb) => ({ tag: verb, count: counts.get(verb) }));
}

/**
 * Lead + up to two action chips, then one `+N` overflow chip. Repeats of the
 * lead's own verb fold into its count instead of eating another slot.
 */
function packChips(lead, chips) {
  const out = lead != null ? [{ ...lead }] : [];
  for (const chip of chips) {
    const same = lead != null ? out.find((shown) => shown.tag === lead.tag) : null;
    if (lead != null && chip.tag === lead.tag) {
      same.count = Math.max(same.count ?? 1, chip.count);
      continue;
    }
    if (out.length >= MAX_STEP_CHIPS) break;
    out.push(chip);
  }
  const shown = new Set(out.map((chip) => chip.tag));
  const rest = chips.filter((chip) => !shown.has(chip.tag)).length;
  if (rest > 0) out.push({ tag: '+' + rest, count: 1, overflow: true });
  return out;
}

/** `{ title, tag, tags, marks: [{ text, tone }] }` for one step row. */
export function stepTitle(step) {
  const calls = step.events.filter((event) => event.type === 'tool/call');
  const texts = step.events.filter((event) => event.type === 'assistant/message' && event.text);
  const notes = [];
  const seenNote = new Set();
  const seenKind = new Set();
  for (const leaf of step.events) {
    if (!leaf.note || seenNote.has(leaf.note)) continue;
    seenNote.add(leaf.note);
    const kind = leaf.noteKind ?? 'note';
    // One mark per kind: retries would otherwise repeat as "重试 1/5 · 重试 2/5".
    if (seenKind.has(kind)) continue;
    seenKind.add(kind);
    notes.push({ kind, text: leaf.note });
  }
  notes.sort((a, b) => (NOTE_PRIORITY[a.kind] ?? 20) - (NOTE_PRIORITY[b.kind] ?? 20));
  const deliver = notes.find((note) => note.kind === 'deliver');

  // Tag-style naming (F135): every title is a chip row plus an object text.
  let title = '';
  let tag = null;
  let tags = [];
  if (texts.length > 0) {
    title = firstSentence(texts[0].text);
    tag = '回复';
    tags = packChips({ tag, count: 1 }, actionChips(calls));
  } else if (calls.length === 1) {
    title = toolTitle(calls[0].toolName, calls[0].argsText);
    if (calls[0].toolName === 'present' && deliver) title = deliver.text;
    tag = leadTag(title);
    // One call = one chip, already named by the title: skip the per-call scan
    // (this is 92% of steps, and it is on the first-paint path — P02).
    tags = [{ tag, count: 1 }];
  } else if (calls.length > 1) {
    title = toolTitle(calls[0].toolName, calls[0].argsText);
    tag = leadTag(title);
    tags = packChips({ tag, count: 1 }, actionChips(calls));
  } else if (notes.length > 0) {
    title = notes[0].text;
    tag = leadTag(title);
    tags = [{ tag, count: 1 }];
  } else if (step.events.some((event) => event.type === 'assistant/message')) {
    // A model call that returned no text and no tool calls: the step burned
    // time and produced nothing, which is exactly what the row should say.
    title = '空回复';
    tag = '空回复';
    tags = [{ tag, count: 1 }];
  } else if (step.events.some((event) => event.type === 'system/message' && event.text)) {
    title = '系统提示词';
    tag = '系统提示词';
    tags = [{ tag, count: 1 }];
  } else if (step.events.some((event) => (event.actor === 'context' || event.actor === 'system') && event.text)) {
    title = '仅注入上下文';
    tag = '仅注入上下文';
    tags = [{ tag, count: 1 }];
  } else if (step.events.some((event) => event.type === 'tool/result')) {
    title = '返回结果';
    tag = '返回结果';
    tags = [{ tag, count: 1 }];
  } else {
    title = '—';
    tags = [];
  }

  const marks = notes
    .filter((note) => note.text !== title && !title.includes(note.text))
    .filter((note) => !(note.kind === 'inject' && notes.length > 1))
    .slice(0, 2)
    .map((note) => ({ text: note.text, tone: note.kind === 'fail' ? 'error' : note.kind === 'retry' ? 'warn' : 'muted' }));

  return { title: clipLine(title, 46) || '—', tag, tags, marks };
}
