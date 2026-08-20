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
const imageInput = document.querySelector('#image-input');
const callButton = document.querySelector('#call-button');
const callPanel = document.querySelector('#call-panel');
const callStatus = document.querySelector('#call-status');
const hangupButton = document.querySelector('#hangup-button');
const incomingCall = document.querySelector('#incoming-call');
const incomingText = document.querySelector('#incoming-text');
const acceptCall = document.querySelector('#accept-call');
const rejectCall = document.querySelector('#reject-call');
const localVideo = document.querySelector('#local-video');
const remoteVideo = document.querySelector('#remote-video');
let isRegistering = false;
let socket;
let currentUsername = '';
let latestMessageTime = 0;
let peerConnection;
let localStream;
let pendingOffer;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

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
  loadMessages(); connectSocket();
}
async function loadMessages() {
  const data = await request('/api/messages');
  messagesEl.innerHTML = '';
  data.forEach(renderMessage);
  latestMessageTime = data.length ? new Date(data[data.length - 1].sentAt).getTime() : Date.now();
  markMessagesSeen();
  scrollMessages();
}
function renderMessage(message) {
  const empty = messagesEl.querySelector('.empty'); if (empty) empty.remove();
  const item = document.createElement('article');
  item.className = `message ${message.username === currentUsername ? 'mine' : ''}`;
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  if (message.image) { const image = document.createElement('img'); image.className = 'shared-image'; image.src = message.image; image.alt = `${message.username} shared a photo`; bubble.appendChild(image); }
  else bubble.textContent = message.text;
  const meta = document.createElement('div'); meta.className = 'message-meta'; meta.textContent = `${message.username} · ${new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  item.append(bubble, meta); messagesEl.appendChild(item);
}
function scrollMessages() {
  requestAnimationFrame(() => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }));
}
function markMessagesSeen() {
  if (currentUsername && latestMessageTime) localStorage.setItem(`do-baatein:last-seen:${currentUsername}`, String(latestMessageTime));
}
function connectSocket() {
  socket = io();
  socket.on('connect', () => socket.emit('reconnect-cancel-leave'));
  socket.on('message:new', message => {
    renderMessage(message); latestMessageTime = new Date(message.sentAt).getTime(); scrollMessages();
    if (!document.hidden) markMessagesSeen();
  });
  socket.on('presence', names => {
    const others = names.filter(name => name !== currentUsername);
    document.querySelector('#presence-text').textContent = others.length ? `${others[0]} online hain` : 'Doosre person ka intezaar hai';
  });
  socket.on('connect_error', () => { document.querySelector('#presence-text').textContent = 'Connection issue'; });
  socket.on('call:incoming', data => {
    pendingOffer = data.offer;
    incomingText.textContent = `${data.caller} is calling`;
    incomingCall.classList.remove('hidden');
    callPanel.classList.remove('hidden');
  });
  socket.on('call:answered', async data => { await peerConnection?.setRemoteDescription(data.answer); callStatus.textContent = 'Connected'; });
  socket.on('call:ice-candidate', async data => { if (peerConnection && data.candidate) await peerConnection.addIceCandidate(data.candidate); });
  socket.on('call:rejected', () => endCall('Call rejected'));
  socket.on('call:ended', () => endCall('Call ended'));
}
async function createPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnection.onicecandidate = event => { if (event.candidate) socket.emit('call:ice-candidate', { candidate: event.candidate }); };
  peerConnection.ontrack = event => { remoteVideo.srcObject = event.streams[0]; };
  peerConnection.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(peerConnection.connectionState)) endCall('Connection lost'); };
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
}
async function startCall() {
  try {
    await createPeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call:invite', { offer });
    callPanel.classList.remove('hidden'); callStatus.textContent = 'Calling...';
  } catch { endCall('Camera/mic permission required'); }
}
async function acceptIncomingCall() {
  try {
    await createPeerConnection();
    await peerConnection.setRemoteDescription(pendingOffer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('call:answer', { answer });
    incomingCall.classList.add('hidden'); callStatus.textContent = 'Connected';
  } catch { endCall('Camera/mic permission required'); }
}
function endCall(status = 'Video call') {
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  if (peerConnection) peerConnection.close();
  localStream = null; peerConnection = null; pendingOffer = null;
  localVideo.srcObject = null; remoteVideo.srcObject = null;
  callPanel.classList.add('hidden'); incomingCall.classList.add('hidden'); callStatus.textContent = status;
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
imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (!file) return;
  if (file.size > 3.5 * 1024 * 1024) { alert('Photo 3.5 MB se chhoti honi chahiye.'); imageInput.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => { socket.emit('image:send', reader.result); imageInput.value = ''; };
  reader.readAsDataURL(file);
});
document.querySelector('#logout').addEventListener('click', async () => {
  await request('/api/logout', { method: 'POST' });
  if (socket) socket.disconnect();
  chatView.classList.add('hidden'); authView.classList.remove('hidden'); authForm.reset(); setMode(false);
});
callButton.addEventListener('click', startCall);
hangupButton.addEventListener('click', () => { socket.emit('call:hangup'); endCall(); });
acceptCall.addEventListener('click', acceptIncomingCall);
rejectCall.addEventListener('click', () => { socket.emit('call:reject'); endCall('Call rejected'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) markMessagesSeen(); });
(async function init() {
  try { const data = await request('/api/me'); if (data.user) showChat(data.user.username); else messagesEl.innerHTML = '<div class="empty">Login karke apni pehli baat shuru karein.</div>'; }
  catch { messagesEl.innerHTML = '<div class="empty">Login karke apni pehli baat shuru karein.</div>'; }
})();
