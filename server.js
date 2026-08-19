const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'do-baatein-change-this-secret';
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':');
  const attempted = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(attempted, 'hex'));
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}
function sessionToken(username) {
  const value = Buffer.from(username).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
  return `${value}.${signature}`;
}
function signedUsername(token) {
  if (!token) return null;
  const [value, signature] = token.split('.');
  if (!value || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { return Buffer.from(value, 'base64url').toString(); } catch { return null; }
}
function cleanName(name) { return String(name || '').trim().toLowerCase().replace(/[^a-z0-9_ -]/g, '').slice(0, 24); }

let users = readJson(USERS_FILE, []);
let messages = readJson(MESSAGES_FILE, []);
const sessions = new Map(Object.entries(readJson(SESSIONS_FILE, {})));
const onlineUsers = new Map();
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).session;
  const username = sessions.get(token) || signedUsername(token);
  return users.find(user => user.username === username) || null;
}
function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });
  req.user = user;
  next();
}
function setSession(res, username) {
  const token = sessionToken(username);
  sessions.set(token, username);
  writeJson(SESSIONS_FILE, Object.fromEntries(sessions));
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=315360000`);
}

app.post('/api/register', (req, res) => {
  const username = cleanName(req.body.username);
  const password = String(req.body.password || '');
  if (users.length >= 2) return res.status(403).json({ error: 'This private room already has two accounts.' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (users.some(user => user.username === username)) return res.status(409).json({ error: 'Username is already taken.' });
  users.push({ username, password: hashPassword(password), createdAt: new Date().toISOString() });
  writeJson(USERS_FILE, users);
  setSession(res, username);
  res.json({ username });
});

app.post('/api/login', (req, res) => {
  const username = cleanName(req.body.username);
  const user = users.find(item => item.username === username);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password)) return res.status(401).json({ error: 'Username or password is incorrect.' });
  setSession(res, username);
  res.json({ username });
});

app.post('/api/logout', requireUser, (req, res) => {
  const token = parseCookies(req.headers.cookie).session;
  sessions.delete(token);
  writeJson(SESSIONS_FILE, Object.fromEntries(sessions));
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.post('/api/leave', requireUser, (req, res) => {
  const token = parseCookies(req.headers.cookie).session;
  sessions.delete(token);
  writeJson(SESSIONS_FILE, Object.fromEntries(sessions));
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? { username: user.username } : null });
});
app.get('/api/messages', requireUser, (req, res) => res.json(messages.slice(-200)));
app.get('/health', (req, res) => res.json({ ok: true }));

io.use((socket, next) => {
  const token = parseCookies(socket.handshake.headers.cookie).session;
  const username = sessions.get(token) || signedUsername(token);
  const user = users.find(item => item.username === username);
  if (!user) return next(new Error('Not authenticated'));
  socket.user = user;
  next();
});
io.on('connection', socket => {
  onlineUsers.set(socket.id, socket.user.username);
  io.emit('presence', [...new Set(onlineUsers.values())]);
  socket.on('message:send', rawText => {
    const text = String(rawText || '').trim().slice(0, 1000);
    if (!text) return;
    const message = { id: crypto.randomUUID(), username: socket.user.username, text, sentAt: new Date().toISOString() };
    messages.push(message);
    messages = messages.slice(-500);
    writeJson(MESSAGES_FILE, messages);
    io.emit('message:new', message);
  });
  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('presence', [...new Set(onlineUsers.values())]);
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, '0.0.0.0', () => console.log(`Private chat running on port ${PORT}`));
