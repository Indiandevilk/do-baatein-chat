const authView = document.querySelector('#auth-view');
const chatView = document.querySelector('#chat-view');
const authForm = document.querySelector('#auth-form');
const toggleAuth = document.querySelector('#toggle-auth');
const authTitle = document.querySelector('#auth-title');
const authSubtitle = document.querySelector('#auth-subtitle');
const authAction = document.querySelector('#auth-action');
const authError = document.querySelector('#auth-error');
const messagesEl = document.querySelector('#messages');
const messageForm = document.querySelector('#message-form');
const messageInput = document.querySelector('#message-input');
let isRegistering = false;
let socket;
let currentUsername = '';
let latestMessageTime = 0;
let unreadCount = 0;

function showError(message = '') { authError.textContent = message; }
function setMode(register) {
  isRegistering = register;
  authSubtitle.textContent = register ? 'Apna username aur password set karein.' : 'Apne account se login karein.';
  authAction.textContent = register ? 'Account banayein' : 'Login karein';
  toggleAuth.textContent = register ? 'Pehle se account hai? Login karein' : 'Naya account banayein';
  showError();
}
async function request(url, options) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function showChat(username) {
  currentUsername = username;
  document.querySelector('#current-user').textContent = username;
  authView.classList.add('hidden'); chatView.classList.remove('hidden');
  loadMessages(); connectSocket(); setupPushNotifications();
}
async function setupPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    const data = await request('/api/push/public-key');
    if (!data.publicKey) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.publicKey) });
    await request('/api/push/subscribe', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
  } catch (error) { console.warn('Push notifications unavailable:', error.message); }
}
function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
}
async function loadMessages() {
  const data = await request('/api/messages');
  const savedTime = Number(localStorage.getItem(`do-baatein:last-seen:${currentUsername}`) || 0);
  const unseen = savedTime ? data.filter(message => message.username !== currentUsername && new Date(message.sentAt).getTime() > savedTime) : [];
  messagesEl.innerHTML = '';
  data.forEach(renderMessage);
  latestMessageTime = data.length ? new Date(data[data.length - 1].sentAt).getTime() : Date.now();
  if (unseen.length) {
    unreadCount += unseen.length;
    updateNotificationLabel();
    notifyUser(`${unseen.length} new message${unseen.length > 1 ? 's' : ''}`, `${unseen[unseen.length - 1].username} ne aapko message bheja hai.`);
  }
  markMessagesSeen();
  scrollMessages();
}
function renderMessage(message) {
  const empty = messagesEl.querySelector('.empty'); if (empty) empty.remove();
  const item = document.createElement('article');
  item.className = `message ${message.username === currentUsername ? 'mine' : ''}`;
  const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = message.text;
  const meta = document.createElement('div'); meta.className = 'message-meta'; meta.textContent = `${message.username} · ${new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  item.append(bubble, meta); messagesEl.appendChild(item);
}
function scrollMessages() {
  requestAnimationFrame(() => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }));
}
function updateNotificationLabel() {
  document.querySelector('#notifications').textContent = unreadCount ? `Notifications (${unreadCount})` : 'Notifications';
  document.title = unreadCount ? `(${unreadCount}) Do Baatein` : 'Do Baatein | Private chat';
}
function markMessagesSeen() {
  if (currentUsername && latestMessageTime) localStorage.setItem(`do-baatein:last-seen:${currentUsername}`, String(latestMessageTime));
  unreadCount = 0;
  updateNotificationLabel();
}
function notifyUser(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: 'do-baatein-message' });
}
async function enableNotifications() {
  if (!('Notification' in window)) return;
  await setupPushNotifications();
  const permission = Notification.permission;
  document.querySelector('#notifications').textContent = permission === 'granted' ? 'Notifications on' : 'Enable notifications';
}
function connectSocket() {
  socket = io();
  socket.on('connect', () => socket.emit('reconnect-cancel-leave'));
  socket.on('message:new', message => {
    renderMessage(message); latestMessageTime = new Date(message.sentAt).getTime(); scrollMessages();
    if (message.username !== currentUsername && document.hidden) {
      unreadCount += 1; updateNotificationLabel();
      notifyUser('New message', `${message.username} ne aapko message bheja hai.`);
    } else if (!document.hidden) markMessagesSeen();
  });
  socket.on('presence', names => {
    const others = names.filter(name => name !== currentUsername);
    document.querySelector('#presence-text').textContent = others.length ? `${others[0]} online hain` : 'Doosre person ka intezaar hai';
  });
  socket.on('connect_error', () => { document.querySelector('#presence-text').textContent = 'Connection issue'; });
}
authForm.addEventListener('submit', async event => {
  event.preventDefault(); showError();
  const username = document.querySelector('#username').value;
  const password = document.querySelector('#password').value;
  try {
    const data = await request(isRegistering ? '/api/register' : '/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    showChat(data.username);
  } catch (error) { showError(error.message); }
});
toggleAuth.addEventListener('click', () => setMode(!isRegistering));
messageForm.addEventListener('submit', event => {
  event.preventDefault();
  if (messageInput.value.trim() && socket) { socket.emit('message:send', messageInput.value); messageInput.value = ''; messageInput.focus(); }
});
document.querySelector('#logout').addEventListener('click', async () => {
  await request('/api/logout', { method: 'POST' });
  if (socket) socket.disconnect();
  chatView.classList.add('hidden'); authView.classList.remove('hidden'); authForm.reset(); setMode(false);
});
document.querySelector('#notifications').addEventListener('click', enableNotifications);
document.addEventListener('visibilitychange', () => { if (!document.hidden) markMessagesSeen(); });
(async function init() {
  try { const data = await request('/api/me'); if (data.user) showChat(data.user.username); else messagesEl.innerHTML = '<div class="empty">Login karke apni pehli baat shuru karein.</div>'; }
  catch { messagesEl.innerHTML = '<div class="empty">Login karke apni pehli baat shuru karein.</div>'; }
})();
