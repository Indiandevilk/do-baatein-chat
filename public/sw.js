self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'Do Baatein', body: 'New message' };
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icon.svg', tag: 'do-baatein-message' }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(openClients => {
    if (openClients.length) return openClients[0].focus();
    return clients.openWindow('/');
  }));
});
