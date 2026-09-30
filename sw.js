/* =====================================================================
   Meu Dinheiro — Service Worker (Fase 1: PWA com armazenamento local)
   ---------------------------------------------------------------------
   O que este Service Worker faz:
     • guarda em cache apenas os ARQUIVOS DO APLICATIVO (interface);
     • permite abrir o app mesmo com conexão instável ou offline;
     • atualiza o cache quando há nova versão, sem tocar nos dados;
     • remove caches antigos automaticamente.

   O que ele NUNCA faz:
     • não guarda dados financeiros do usuário no cache;
     • não intercepta a chave do banco local (meudinheiro.db.v1);
     • não faz requisições para serviços externos.

   O banco financeiro continua exclusivamente no localStorage do navegador.
   ===================================================================== */

const MEU_DINHEIRO_CACHE_VERSION = 'v1.0.0'; /* ← trocar a cada nova versão publicada */
const MEU_DINHEIRO_CACHE_PREFIX = 'meu-dinheiro-';
const CACHE_NAME = MEU_DINHEIRO_CACHE_PREFIX + MEU_DINHEIRO_CACHE_VERSION;

const DB_KEY = 'meudinheiro.db.v1';            /* nunca cachear nada relacionado a isso */
const APP_SHELL = './meu-dinheiro.html';       /* página principal do aplicativo */

const PRECACHE_URLS = [
  './',
  APP_SHELL,
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png'
];

/* Arquivos do app que podem ser servidos do cache (por extensão). */
const CACHEABLE_DESTINATIONS = ['document', 'script', 'style', 'image', 'manifest', 'font', 'worker'];

/* ---------------------------------------------------------------------
   INSTALAÇÃO — pré-carrega os arquivos do app
   --------------------------------------------------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    /* allSettled: se um arquivo opcional faltar, a instalação não quebra */
    await Promise.allSettled(
      PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
    );
    await self.skipWaiting();
  })());
});

/* ---------------------------------------------------------------------
   ATIVAÇÃO — apaga caches de versões antigas e assume o controle
   --------------------------------------------------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.indexOf(MEU_DINHEIRO_CACHE_PREFIX) === 0 && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

/* ---------------------------------------------------------------------
   MENSAGENS — atualização imediata e versão do cache
   --------------------------------------------------------------------- */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (data.type === 'GET_VERSION' && event.source && event.source.postMessage) {
    event.source.postMessage({ type: 'VERSION', version: MEU_DINHEIRO_CACHE_VERSION });
  }
});

/* ---------------------------------------------------------------------
   Regras de segurança do cache
   --------------------------------------------------------------------- */
function mustNeverCache(url, request) {
  if (request.method !== 'GET') return true;                  /* somente leitura */
  if (url.origin !== self.location.origin) return true;       /* nada de terceiros */
  if (url.href.indexOf(DB_KEY) !== -1) return true;           /* nunca dados financeiros */
  if (url.pathname.endsWith('.json') && url.pathname.indexOf('manifest') === -1) return true; /* só o manifest */
  if (request.headers.get('range')) return true;              /* requisições parciais */
  if (url.searchParams.has('backup') || url.searchParams.has('data')) return true;
  return false;
}
function isCacheableAsset(url, request) {
  if (mustNeverCache(url, request)) return false;
  if (request.mode === 'navigate' || request.destination === 'document') return true;
  if (CACHEABLE_DESTINATIONS.indexOf(request.destination) !== -1) return true;
  return /\.(html|js|css|png|jpg|jpeg|svg|webp|ico|woff2?|json)$/i.test(url.pathname);
}

/* ---------------------------------------------------------------------
   BUSCA (fetch)
     • navegação  → rede primeiro, cache como reserva (offline funciona)
     • arquivos   → cache primeiro, atualização em segundo plano
   --------------------------------------------------------------------- */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  let url;
  try { url = new URL(request.url); } catch (e) { return; }

  if (mustNeverCache(url, request) && !(request.mode === 'navigate')) return;
  if (!isCacheableAsset(url, request)) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE_NAME);
        const hit = (await cache.match(request, { ignoreSearch: true })) || (await cache.match(APP_SHELL));
        if (hit) return hit;
        return new Response(
          '<!DOCTYPE html><html lang="pt-BR"><meta charset="utf-8"><title>Meu Dinheiro</title>' +
          '<body style="font-family:system-ui;padding:32px"><h1>Meu Dinheiro</h1>' +
          '<p>Você está offline e esta página ainda não foi carregada neste dispositivo.</p>' +
          '<p>Conecte-se à internet uma vez para liberar o uso offline.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request)
      .then((response) => {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => null);
    if (cached) return cached;                 /* responde rápido e atualiza em segundo plano */
    const fresh = await network;
    return fresh || new Response('', { status: 504, statusText: 'Offline' });
  })());
});
