// Ελάχιστος service worker: επιτρέπει την εγκατάσταση της εφαρμογής στο κινητό.
// Δεν κρατά αντίγραφα αρχείων, ώστε κάθε νέα έκδοση να φορτώνεται αμέσως.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
