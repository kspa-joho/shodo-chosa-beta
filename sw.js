const CACHE_NAME = 'survey-app-v1'; // アプリ本体も地図もこれ一つで管理（シンプル化）

// インストール時に「これだけは絶対に確保する」ファイル
// ※ここにHTMLは含めない（ファイル名が変わるリスク回避）
const STATIC_ASSETS = [
    'manifest.json',
    'icon.png'
];

// 地図タイルのURLパターン
const TILE_URL_PATTERNS = [
    'https://cyberjapandata.gsi.go.jp/xyz/',
    'https://server.arcgisonline.com/ArcGIS/rest/services/'
];

// 1. Install: 基本ファイルのみキャッシュ
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // 失敗しても止まらないように catch をつける
            return cache.addAll(STATIC_ASSETS).catch(err => console.warn('Static assets cache warning:', err));
        }).then(() => self.skipWaiting())
    );
});

// 2. Activate: 即座に制御開始
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// 3. Fetch: 通信をフックしてキャッシュ
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // A. 地図タイルへのアクセス
    const isTile = TILE_URL_PATTERNS.some(p => url.href.startsWith(p));
    
    // B. アプリ本体（自分のサーバー上のファイル）へのアクセス
    // ※ url.origin が自分のドメインと同じならキャッシュ対象とする
    const isAppContent = (url.origin === location.origin);

    if (isTile || isAppContent) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cachedResponse) => {
                    // 1. キャッシュがあれば、まずそれを返す（高速化・オフライン対応）
                    // 2. その裏で、ネットワークから最新版を取りに行く
                    // 3. 取れたらキャッシュを更新しておく（次回用）
                    const fetchPromise = fetch(event.request).then((networkResponse) => {
                        // 正常なレスポンスならキャッシュに保存
                        if (networkResponse && networkResponse.status === 200) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(() => {
                        // オフライン等で失敗したら何もしない
                    });

                    // キャッシュがあればそれを返す。なければネットワークの結果を待つ
                    return cachedResponse || fetchPromise;
                });
            })
        );
    }
});

// 4. Message: キャッシュ操作
self.addEventListener('message', (event) => {
    if (event.data.action === 'clear-tile-cache') {
        caches.delete(CACHE_NAME).then(() => console.log('Cache cleared'));
    }

    // メインスレッドから「今すぐ更新して」と言われたら即座に制御を奪う
    if (event.data.action === 'skip-waiting') {
        self.skipWaiting();
    }
    
    // 地図一括保存
    if (event.data.action === 'cache-tiles-in-bounds') {
        const { bounds, minZoom, maxZoom } = event.data.payload;
        const urlsToCache = [];

        for (let z = minZoom; z <= maxZoom; z++) {
            const minTile = latLonToTile(bounds.north, bounds.west, z);
            const maxTile = latLonToTile(bounds.south, bounds.east, z);
            for (let x = minTile.x; x <= maxTile.x; x++) {
                for (let y = minTile.y; y <= maxTile.y; y++) {
                    // 地理院標準
                    urlsToCache.push(`https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${x}/${y}.png`);
                    // 地理院写真
                    urlsToCache.push(`https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`);
                }
            }
        }
        
        caches.open(CACHE_NAME).then((cache) => {
            console.log(`Caching ${urlsToCache.length} tiles...`);
            // エラーが出ても止まらないように一つずつadd
            urlsToCache.forEach(url => {
                cache.add(url).catch(e => {/*無視*/});
            });
        });
    }
});

function latLonToTile(lat, lon, zoom) {
    const latRad = lat * Math.PI / 180;
    const n = Math.pow(2, zoom);
    const x = Math.floor(n * ((lon + 180) / 360));
    const y = Math.floor(n * (1 - (Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2);
    return { x, y };
}