import assert from 'node:assert/strict';
import test from 'node:test';
import { actionLine, redactSecrets, transcriptTurns } from './capture-lib.mjs';

const line = (entry) => JSON.stringify(entry);

test('a transcript becomes the person\'s prompts and the agent\'s replies, nothing else', () => {
  const lines = [
    line({ type: 'mode', mode: 'default' }),
    line({ type: 'user', uuid: 'u1', timestamp: '2026-10-03T01:00:00Z', message: { role: 'user', content: 'Make the login button green' } }),
    line({ type: 'user', uuid: 'm1', isMeta: true, message: { role: 'user', content: 'Caveat: harness note' } }),
    line({ type: 'assistant', uuid: 'a1', timestamp: '2026-10-03T01:00:05Z', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'private reasoning' },
      { type: 'tool_use', name: 'Read', input: { file_path: 'app/Login.tsx' } },
    ] } }),
    line({ type: 'user', uuid: 't1', message: { role: 'user', content: [{ type: 'tool_result', content: 'export function Login() {...}' }] } }),
    line({ type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [
      { type: 'tool_use', name: 'Edit', input: { file_path: 'app/Login.tsx', old_string: 'x', new_string: 'y' } },
      { type: 'text', text: 'Done: the button uses #569C79.' },
    ] } }),
    line({ type: 'assistant', uuid: 's1', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'subagent noise' }] } }),
    line({ type: 'user', uuid: 'c1', message: { role: 'user', content: '<command-name>/mcp</command-name>' } }),
    line({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'Thanks <system-reminder>ignore me</system-reminder>' } }),
    'not json',
  ];
  assert.deepEqual(transcriptTurns(lines), [
    { id: 'u1', role: 'user', text: 'Make the login button green', at: '2026-10-03T01:00:00Z' },
    { id: 'a1', role: 'assistant', text: 'Done: the button uses #569C79.\n\n→ Read app/Login.tsx\n→ Edit app/Login.tsx', at: '2026-10-03T01:00:05Z' },
    { id: 'c1', role: 'user', text: '/mcp', at: null },
    { id: 'u2', role: 'user', text: 'Thanks', at: null },
  ]);
});

test('actions name the tool and its target, never its output, and hide secrets', () => {
  assert.equal(actionLine({ name: 'Bash', input: { command: 'npm test\nmore' } }), '→ Bash npm test');
  assert.equal(actionLine({ name: 'mcp__claude_ai_Slack__search', input: { query: 'brand' } }), '→ Slack: search brand');
  assert.equal(actionLine({ name: 'Bash', input: { command: 'export API_KEY=abc123' } }), '→ Bash export API_KEY=[redacted]');
  assert.equal(actionLine({ name: 'TodoWrite', input: { todos: [] } }), '→ TodoWrite');
});

test('secrets are stripped before anything leaves the machine', () => {
  const out = redactSecrets('key sk-proj-abcdefghijklmnopqrstuvwx and Bearer abcdefghijklmnopqrstuvwxyz and postgres://u:hunter2@h/db');
  assert.ok(!/abcdefghijklmnop|hunter2/.test(out), out);
  assert.equal(redactSecrets('plain words, #569C79'), 'plain words, #569C79');
});

test('slash commands keep their name and arguments', () => {
  const turns = transcriptTurns([JSON.stringify({ type: 'user', uuid: 'c', message: { role: 'user',
    content: '<command-message>oru:sync</command-message>\n<command-name>/oru:sync</command-name>\n<command-args>drive</command-args>' } })]);
  assert.equal(turns[0].text, '/oru:sync drive');
});
