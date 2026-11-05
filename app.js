const express = require('express');
const { randomUUID } = require('node:crypto');

const states = ['todo', 'doing', 'done'];
const fields = ['title', 'description', 'state', 'dueDate'];

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validate(body, creating) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Body must be a JSON object.';
  }
  if (Object.keys(body).some(key => !fields.includes(key))) {
    return 'Only title, description, state and dueDate can be sent.';
  }
  if (creating && !Object.hasOwn(body, 'title')) return 'Title is required.';
  if (!creating && Object.keys(body).length === 0) return 'Send at least one field to update.';
  if (Object.hasOwn(body, 'title') &&
      (typeof body.title !== 'string' || !body.title.trim())) {
    return 'Title must be a non-empty string.';
  }
  if (Object.hasOwn(body, 'description') && typeof body.description !== 'string') {
    return 'Description must be a string.';
  }
  if (Object.hasOwn(body, 'state') && !states.includes(body.state)) {
    return 'State must be todo, doing or done.';
  }
  if (Object.hasOwn(body, 'dueDate') && !validDate(body.dueDate)) {
    return 'dueDate must be a real date in YYYY-MM-DD format.';
  }
  return null;
}

function createApp() {
  const app = express();
  const todos = [];
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  // Create and update requests must contain JSON.
  app.use((req, res, next) => {
    if (['POST', 'PUT'].includes(req.method) &&
        (req.path === '/todos' || req.path.startsWith('/todos/')) &&
        !req.is('application/json')) {
      return res.status(415).json({ error: 'Use Content-Type: application/json.' });
    }
    next();
  });
  app.use(express.json({ strict: false, limit: '16kb' }));

  app.post('/todos', (req, res) => {
    const error = validate(req.body, true);
    if (error) return res.status(400).json({ error });
    const now = new Date().toISOString();
    const todo = {
      id: randomUUID(),
      title: req.body.title.trim(),
      description: req.body.description ?? '',
      state: req.body.state ?? 'todo',
      ...(Object.hasOwn(req.body, 'dueDate') ? { dueDate: req.body.dueDate } : {}),
      createdAt: now,
      updatedAt: now
    };
    todos.push(todo);
    res.location(`/todos/${todo.id}`).status(201).json(todo);
  });

  app.get('/todos', (req, res) => {
    if (Object.keys(req.query).some(key => key !== 'state')) {
      return res.status(400).json({ error: 'Only the state query filter is supported.' });
    }
    const state = req.query.state;
    if (state !== undefined && (typeof state !== 'string' || !states.includes(state))) {
      return res.status(400).json({ error: 'State filter must be todo, doing or done, once only.' });
    }
    res.json(state === undefined ? todos : todos.filter(todo => todo.state === state));
  });

  app.get('/todos/:id', (req, res) => {
    const todo = todos.find(item => item.id === req.params.id);
    if (!todo) return res.status(404).json({ error: 'Todo not found.' });
    res.json(todo);
  });

  // PUT supports partial changes, as in the assignment's state-only example.
  app.put('/todos/:id', (req, res) => {
    const todo = todos.find(item => item.id === req.params.id);
    if (!todo) return res.status(404).json({ error: 'Todo not found.' });
    const error = validate(req.body, false);
    if (error) return res.status(400).json({ error });
    Object.assign(todo, req.body);
    if (Object.hasOwn(req.body, 'title')) todo.title = req.body.title.trim();
    todo.updatedAt = new Date().toISOString();
    res.json(todo);
  });

  app.delete('/todos/:id', (req, res) => {
    const index = todos.findIndex(item => item.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Todo not found.' });
    todos.splice(index, 1);
    res.status(204).end();
  });

  app.use((req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Body contains invalid JSON.' });
    }
    if (err.status === 413) return res.status(413).json({ error: 'JSON body is too large. Maximum is 16 KB.' });
    if (err.status === 415) return res.status(415).json({ error: 'Unsupported JSON charset or encoding.' });
    if (err.status === 400) return res.status(400).json({ error: 'Invalid request.' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error.' });
  });
  return app;
}

module.exports = { createApp };
