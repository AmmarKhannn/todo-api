const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../app');
let server;
let base;
before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

async function request(method, path, body, headers = {}, raw = false) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {})
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}
async function create(body = { title: 'Study APIs' }) {
  const r = await request('POST', '/todos', body);
  assert.equal(r.status, 201);
  return r.body;
}
function error(r, status) {
  assert.equal(r.status, status);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal(typeof r.body.error, 'string');
}

test('full CRUD cycle, headers, fields, timestamps and deletion', async () => {
  const r = await request('POST', '/todos', {
    title: '  Study APIs  ', description: 'Read the docs', state: 'todo', dueDate: '2028-02-29'
  });
  assert.equal(r.status, 201);
  const todo = r.body;
  assert.match(todo.id, /^[0-9a-f-]{36}$/);
  assert.equal(r.headers.get('location'), `/todos/${todo.id}`);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal(todo.title, 'Study APIs');
  assert.equal(todo.description, 'Read the docs');
  assert.equal(todo.dueDate, '2028-02-29');
  assert.equal(todo.createdAt, todo.updatedAt);
  assert.ok(Number.isFinite(Date.parse(todo.createdAt)));
  assert.deepEqual((await request('GET', `/todos/${todo.id}`)).body, todo);
  const updated = await request('PUT', `/todos/${todo.id}`, { state: 'doing' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.state, 'doing');
  assert.equal(updated.body.title, todo.title);
  assert.equal(updated.body.createdAt, todo.createdAt);
  assert.ok(Date.parse(updated.body.updatedAt) >= Date.parse(todo.updatedAt));
  assert.equal((await request('DELETE', `/todos/${todo.id}`)).status, 204);
  error(await request('GET', `/todos/${todo.id}`), 404);
});

test('default state, optional fields and unique IDs', async () => {
  const a = await create(); const b = await create();
  assert.equal(a.state, 'todo'); assert.equal(a.description, '');
  assert.equal('dueDate' in a, false); assert.notEqual(a.id, b.id);
});

test('all states can be created, filtered and updated', async () => {
  for (const state of ['todo', 'doing', 'done']) {
    const item = await create({ title: state, state });
    const list = await request('GET', `/todos?state=${state}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.some(t => t.id === item.id));
    assert.ok(list.body.every(t => t.state === state));
    const updated = await request('PUT', `/todos/${item.id}`, { state, title: ' Changed ', description: '', dueDate: '2027-01-01' });
    assert.equal(updated.status, 200); assert.equal(updated.body.title, 'Changed');
    assert.equal(updated.body.dueDate, '2027-01-01');
  }
  const all = await request('GET', '/todos');
  assert.equal(all.status, 200); assert.ok(Array.isArray(all.body));
});

test('empty list and empty filtered list are successful', async () => {
  const fresh = createApp().listen(0, '127.0.0.1'); await once(fresh, 'listening');
  try {
    for (const path of ['/todos', '/todos?state=done']) {
      const r = await fetch(`http://127.0.0.1:${fresh.address().port}${path}`);
      assert.equal(r.status, 200); assert.deepEqual(await r.json(), []);
    }
  } finally { await new Promise(resolve => fresh.close(resolve)); }
});

const invalidBodies = [
  ['array', []], ['null', null], ['string', 'hello'], ['number', 123], ['boolean', true],
  ['title missing', { description: 'No title' }],
  ['title empty', { title: '' }], ['title spaces', { title: '   ' }],
  ['title wrong type', { title: 12 }], ['title null', { title: null }],
  ['description wrong type', { title: 'Test', description: 12 }],
  ['description null', { title: 'Test', description: null }],
  ['invalid state', { title: 'Test', state: 'finished' }],
  ['uppercase state', { title: 'Test', state: 'TODO' }],
  ['null state', { title: 'Test', state: null }],
  ['number state', { title: 'Test', state: 1 }],
  ['wrong date format', { title: 'Test', dueDate: 'tomorrow' }],
  ['impossible date', { title: 'Test', dueDate: '2026-02-30' }],
  ['wrong date type', { title: 'Test', dueDate: 123 }],
  ['null date', { title: 'Test', dueDate: null }],
  ['unknown field', { title: 'Test', extra: true }],
  ['client-supplied id', { title: 'Test', id: 'mine' }],
  ['client-supplied timestamp', { title: 'Test', createdAt: 'today' }],
  ['client-supplied updatedAt', { title: 'Test', updatedAt: 'today' }]
];
for (const [name, body] of invalidBodies) {
  test(`POST rejects ${name}`, async () => error(await request('POST', '/todos', body), 400));
  // On update, title may be omitted, so that create-only case is excluded.
  if (name !== 'title missing') {
    test(`PUT rejects ${name} without changing stored data`, async () => {
      const item = await create();
      error(await request('PUT', `/todos/${item.id}`, body), 400);
      assert.deepEqual((await request('GET', `/todos/${item.id}`)).body, item);
    });
  }
}

test('PUT rejects empty object', async () => {
  const item = await create(); error(await request('PUT', `/todos/${item.id}`, {}), 400);
});
for (const query of ['state=wrong', 'state=', 'state=todo&state=done', 'other=todo', 'state[]=todo']) {
  test(`GET rejects query ${query}`, async () => error(await request('GET', `/todos?${query}`), 400));
}
for (const method of ['GET', 'PUT', 'DELETE']) {
  test(`${method} unknown todo returns 404`, async () => {
    error(await request(method, '/todos/1000', method === 'PUT' ? { state: 'done' } : undefined), 404);
  });
}
for (const method of ['POST', 'PUT']) {
  test(`${method} malformed JSON returns 400`, async () => {
    const path = method === 'PUT' ? `/todos/${(await create()).id}` : '/todos';
    error(await request(method, path, '{"title":', {}, true), 400);
  });
  test(`${method} missing body returns 400`, async () => {
    const path = method === 'PUT' ? `/todos/${(await create()).id}` : '/todos';
    error(await request(method, path, '', { 'Content-Type': 'application/json' }, true), 400);
  });
  test(`${method} wrong Content-Type returns 415`, async () => {
    const path = method === 'PUT' ? `/todos/${(await create()).id}` : '/todos';
    error(await request(method, path, '{}', { 'Content-Type': 'text/plain' }, true), 415);
  });
  test(`${method} missing Content-Type returns 415`, async () => {
    const path = method === 'PUT' ? `/todos/${(await create()).id}` : '/todos';
    error(await request(method, path), 415);
  });
  test(`${method} oversized body returns 413`, async () => {
    const path = method === 'PUT' ? `/todos/${(await create()).id}` : '/todos';
    error(await request(method, path, { title: 'Test', description: 'x'.repeat(17000) }), 413);
  });
  test(`${method} unsupported charset returns 415`, async () => {
    const path = method === 'PUT' ? `/todos/${(await create()).id}` : '/todos';
    error(await request(method, path, '{}', { 'Content-Type': 'application/json; charset=iso-8859-1' }, true), 415);
  });
  test(`${method} unsupported encoding returns 415`, async () => {
    const path = method === 'PUT' ? `/todos/${(await create()).id}` : '/todos';
    error(await request(method, path, '{}', { 'Content-Encoding': 'unknown' }, true), 415);
  });
}
test('unknown endpoint returns JSON 404', async () => error(await request('GET', '/missing'), 404));
test('malformed URL returns JSON 400', async () => error(await request('GET', '/todos/%ZZ'), 400));
