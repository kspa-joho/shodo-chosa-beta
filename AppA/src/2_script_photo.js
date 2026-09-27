// =============================================================================
// 写真IndexedDB管理 (photoStorage)
// =============================================================================
// 設計方針：
//   ・写真のdataUrlをIndexedDBに保存することで、アプリが落ちても写真が消えない。
//   ・LocalStorage（5MB上限）では写真を保存できないため、IndexedDBを使う。
//   ・iOSはPWAとしてインストールすれば7日以上データが保持される。
//   ・photoApp.photos[]の操作と連動して自動で保存・削除・復元を行う。
//
// 【Phase 6.11】複数現場管理（改修指示書Step2-⑥）に対応するため、レコードに
// siteId（現場ID）を持たせ、キーを "siteId::インデックス番号" の複合キーに変更した。
// これにより、同じDBの中で現場ごとに写真を区別して持てる。
// siteIdを省略した呼び出しは、window.siteManagerの現在の現場（無ければ'default'）を
// 自動で使うため、⑥導入前の古い呼び出し方（引数なし）とも互換性がある。
// 旧形式（siteIdタグ無し・idが単なる整数）のレコードは、後方互換のため
// 「現在の現場のもの」として扱う（既存ユーザーの現場移行時に問題が出ないように）。
// =============================================================================
window.photoStorage = {
    DB_NAME: 'survey_photo_db',
    STORE:   'photos',
    _db: null,

    open() {
        return new Promise((resolve, reject) => {
            if (this._db) { resolve(this._db); return; }
            const req = indexedDB.open(this.DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                e.target.result.createObjectStore(this.STORE, { keyPath: 'id' });
            };
            req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
            req.onerror   = (e) => reject(e.target.error);
        });
    },

    _currentSiteId() {
        return (window.siteManager && window.siteManager.getCurrentSiteId()) || 'default';
    },
    _key(siteId, index) { return `${siteId}::${index}`; },

    // 写真を保存（siteId + インデックス番号）
    async save(siteId, index, dataUrl) {
        try {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readwrite');
                tx.objectStore(this.STORE).put({ id: this._key(siteId, index), siteId, index, dataUrl });
                tx.oncomplete = resolve;
                tx.onerror    = reject;
            });
        } catch(e) { console.warn("photoStorage.save failed:", e); }
    },

    // 全件取得（DB内の全現場ぶん）
    async getAll() {
        try {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx  = db.transaction(this.STORE, 'readonly');
                const req = tx.objectStore(this.STORE).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror   = reject;
            });
        } catch(e) { console.warn("photoStorage.getAll failed:", e); return []; }
    },

    // 指定した現場ぶんだけを取得する（旧形式の未タグレコードも現在の現場として扱う）
    async getAllForSite(siteId) {
        const all = await this.getAll();
        return all.filter(r => r.siteId === siteId || (r.siteId === undefined && typeof r.id === 'number'));
    },

    // 指定した現場ぶんだけを削除する
    async clearAllForSite(siteId) {
        try {
            const db = await this.open();
            const records = await this.getAllForSite(siteId);
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readwrite');
                const store = tx.objectStore(this.STORE);
                records.forEach(r => store.delete(r.id));
                tx.oncomplete = resolve;
                tx.onerror    = reject;
            });
        } catch(e) { console.warn("photoStorage.clearAllForSite failed:", e); }
    },
    // 後方互換：siteId省略時は現在の現場ぶんだけを削除する
    async clearAll() {
        return this.clearAllForSite(this._currentSiteId());
    },

    // photos[]全体を、指定した現場のぶんとしてDBに同期する（並び替え後など）
    async syncAll(photos, siteId) {
        const sid = siteId || this._currentSiteId();
        try {
            await this.clearAllForSite(sid);
            for (let i = 0; i < photos.length; i++) {
                await this.save(sid, i, photos[i].dataUrl);
            }
        } catch(e) { console.warn("photoStorage.syncAll failed:", e); }
    },

    // 指定した現場の写真をDBから復元する（現場切替・起動時に使う）
    async restoreForSite(siteId) {
        const sid = siteId || this._currentSiteId();
        const records = await this.getAllForSite(sid);
        if (!records.length) return;
        records.sort((a, b) => (a.index ?? a.id) - (b.index ?? b.id));
        records.forEach((rec, i) => {
            if (window.photoApp.photos[i]) {
                window.photoApp.photos[i].dataUrl = rec.dataUrl;
            }
        });
        window.photoApp.render();
        window.photoApp.updateHeaderSummary();
    },
    // 後方互換：siteId省略時は現在の現場ぶんを復元する
    async restore() {
        return this.restoreForSite(this._currentSiteId());
    }
};

// =============================================================================
// GPS管理 (gpsManager)
// =============================================================================
// 設計方針：
//   ・写真タブを開いたタイミングで watchPosition() を起動する。
//   ・精度30m以内を「良好」、超えたら「精度低」、取得不可は「未取得」の3状態で管理。
//   ・ステータスに応じて撮影ボタンの表示を切り替える。
//   ・記録ボタンで現在の lat/lng/gpsAccuracy を現在の写真に付与する。
//   ・0と未記録(null)は別物として扱う。
// =============================================================================
window.gpsManager = {
    lat: null,
    lng: null,
    accuracy: null,       // 取得時の精度（メートル）。null=未取得
    status: 'init',       // 'init' | 'good' | 'low' | 'unavailable'
    _watchId: null,
    isStarted: false,

    start() {
        if (this.isStarted) return;
        if (!navigator.geolocation) {
            this.status = 'unavailable';
            this._updateUI();
            return;
        }
        this.isStarted = true;
        this._watchId = navigator.geolocation.watchPosition(
            (pos) => {
                this.lat      = pos.coords.latitude;
                this.lng      = pos.coords.longitude;
                this.accuracy = Math.round(pos.coords.accuracy);
                this.status   = this.accuracy <= 30 ? 'good' : 'low';
                this._updateUI();
            },
            (err) => {
                this.status = 'unavailable';
                this._updateUI();
                console.warn("GPS error:", err);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    },

    // 撮影ボタンのラベルを GPS 状態に合わせて更新する
    _updateUI() {
        const btn = document.getElementById('photo-camera-btn');
        if (!btn) return;
        const labels = {
            init:        '📷 撮影（GPS準備中）',
            good:        '📷 撮影（GPS良好）',
            low:         '📷 撮影（GPS精度低）',
            unavailable: '📷 撮影（GPS未取得）'
        };
        const colors = {
            init:        '#2c3e50',
            good:        '#27ae60',
            low:         '#e67e22',
            unavailable: '#95a5a6'
        };
        btn.textContent = labels[this.status] || labels.init;
        btn.style.background = colors[this.status] || colors.init;

        // GPS ステータス表示も更新
        const el = document.getElementById('gps-live');
        if (!el) return;
        const texts = {
            init:        '準備中...',
            good:        `受信中 (誤差 ${this.accuracy}m)　${this.lat.toFixed(6)}, ${this.lng.toFixed(6)}`,
            low:         `精度低 (誤差 ${this.accuracy}m)　${this.lat.toFixed(6)}, ${this.lng.toFixed(6)}`,
            unavailable: '取得不可'
        };
        const tColors = { init: '#aaa', good: '#27ae60', low: '#e67e22', unavailable: '#e74c3c' };
        el.textContent = texts[this.status] || texts.init;
        el.style.color  = tColors[this.status] || tColors.init;
    },

    // 撮影時に写真へ記録するGPSデータを返す（未取得はnull）
    getCurrentForPhoto() {
        if (this.status === 'init' || this.status === 'unavailable' || this.lat === null) return null;
        return { lat: this.lat, lng: this.lng, gpsAccuracy: this.accuracy };
    }
};

// =============================================================================
// 方位センサー管理 (azimuthManager)
// =============================================================================
// 設計方針：
//   ・写真タブを開いたタイミングで起動する（iOSはユーザー操作起点が必須）。
//   ・センサーが動いている間はリアルタイムで #azimuth-live に常時表示する。
//   ・写真への方位記録は「記録」ボタンで明示的に行う（備考と同じ操作感）。
//   ・0（真北）と null（未記録）は別物として扱う。
// =============================================================================
window.azimuthManager = {
    currentAzimuth: null,
    isListening: false,

    async startListening() {
        if (this.isListening) {
            this._updateLiveUI();
            return true;
        }

        // iOS13以降: requestPermission が必要（ユーザー操作起点で呼ぶこと）
        if (
            typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function'
        ) {
            try {
                const response = await DeviceOrientationEvent.requestPermission();
                if (response !== 'granted') {
                    this._setLiveUI('センサー利用が拒否されました', '#e74c3c');
                    return false;
                }
                // iOS: 許可取得後に deviceorientation を登録
                window.addEventListener('deviceorientation', (e) => this._handleOrientation(e), true);
                this.isListening = true;
                this._setLiveUI('センサー起動中...', '#e67e22');
                return true;
            } catch (e) {
                this._setLiveUI('センサー取得エラー', '#e74c3c');
                return false;
            }
        }

        // Android: deviceorientationabsolute が使えるなら真北基準で登録
        if ('ondeviceorientationabsolute' in window) {
            window.addEventListener('deviceorientationabsolute', (e) => this._handleOrientation(e), true);
        } else {
            // フォールバック: 通常の deviceorientation
            window.addEventListener('deviceorientation', (e) => this._handleOrientation(e), true);
        }

        this.isListening = true;
        this._setLiveUI('センサー起動中...', '#e67e22');
        return true;
    },

    // 方位計算（参考アプリと同じロジック）
    _handleOrientation(e) {
        let az = 0;
        if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
            // iOS: webkitCompassHeadingは真北基準で直接使える
            az = e.webkitCompassHeading;
        } else if (e.alpha !== null && e.alpha !== undefined) {
            // Android: alphaから方位を計算
            az = 360 - e.alpha;
        }
        if (az < 0) az += 360;
        if (az >= 360) az -= 360;
        this.currentAzimuth = Math.round(az);
        this._updateLiveUI();
    },

    _updateLiveUI() {
        if (this.currentAzimuth === null) return;
        this._setLiveUI(`${this.currentAzimuth}°　${this._dir(this.currentAzimuth)}`, '#27ae60');
    },

    _setLiveUI(text, color) {
        const el = document.getElementById('azimuth-live');
        if (!el) return;
        el.textContent = text;
        el.style.color  = color;
    },

    _dir(az) {
        const dirs = ["北","北北東","北東","東北東","東","東南東","南東","南南東",
                      "南","南南西","南西","西南西","西","西北西","北西","北北西"];
        return dirs[Math.floor(((az + 11.25) % 360) / 22.5)];
    }
};

// =============================================================================
// 写真管理 (photoApp)
// =============================================================================
// photos[] の各要素：{ dataUrl, memo, tag, azimuth, lat, lng, gpsAccuracy }
//   azimuth    : null=未記録 / 整数(度) ※0は真北で有効値
//   lat/lng    : null=未記録 / 数値
//   gpsAccuracy: null=未記録 / 数値(m) ※記録ボタンを押した時点の精度
// =============================================================================
window.photoApp = {
    photos: [],
    currentIndex: -1,

    // ---- カメラ撮影からのファイル受け取り（GPS自動記録） ----
    async handleCameraFile(input) {
        const targetW = this._getResizeWidth();
        const force43 = this._getForce43();
        const gps = gpsManager.getCurrentForPhoto();
        for (const file of Array.from(input.files)) {
            const d = await this.resizeImage(file, targetW, force43);
            this.photos.push({
                dataUrl: d, memo: "", tag: "補足",
                azimuth: null,
                lat:         gps ? gps.lat         : null,
                lng:         gps ? gps.lng         : null,
                gpsAccuracy: gps ? gps.gpsAccuracy : null,
                gpsFixed: false
            });
        }
        this.currentIndex = this.photos.length - 1;
        this.runSort();
        // IndexedDBに全写真を同期（runSortで順番が変わるため全件同期）
        await photoStorage.syncAll(this.photos);
        this.render(); this.updateHeaderSummary();
        input.value = "";
    },

    // ---- ファイル選択からのファイル受け取り（EXIFからGPS読み込み） ----
    async handleFileSelect(input) {
        const targetW = this._getResizeWidth();
        const force43 = this._getForce43();
        for (const file of Array.from(input.files)) {
            const { dataUrl, lat, lng } = await this.resizeAndReadExif(file, targetW, force43);
            this.photos.push({
                dataUrl, memo: "", tag: "補足",
                azimuth: null, lat, lng, gpsAccuracy: null, gpsFixed: false
            });
        }
        this.currentIndex = this.photos.length - 1;
        this.runSort();
        // IndexedDBに全写真を同期
        await photoStorage.syncAll(this.photos);
        this.render(); this.updateHeaderSummary();
        input.value = "";
    },

    _getResizeWidth() {
        const sel = document.getElementById('photo-resize-width');
        if (!sel) return 1200;
        return parseInt(sel.value) || 0;
    },

    // 4:3強制チェックの状態を取得
    _getForce43() {
        const cb = document.getElementById('photo-force-43');
        return cb ? cb.checked : false;
    },

    // ---- 画像リサイズ＋4:3強制クロップ ----
    // 処理順序：
    //   1. force43=trueなら縦を基準に左寄せで右側をカット（4:3にトリミング）
    //   2. 指定横幅にリサイズ（targetWは4:3後の横幅が基準）
    // targetW=0 の場合はリサイズなし
    resizeImage(f, targetW, force43) {
        return new Promise((res) => {
            const r = new FileReader();
            r.readAsDataURL(f);
            r.onload = (e) => {
                const i = new Image();
                i.src = e.target.result;
                i.onload = () => {
                    let sw = i.width;   // 切り出し幅
                    let sh = i.height;  // 切り出し高さ
                    // 4:3クロップ：縦を基準に横を縦×4/3に（右側カット）
                    if (force43) {
                        const w43 = Math.floor(sh * 4 / 3);
                        if (w43 < sw) {
                            sw = w43; // 横長画像：右側をカット
                        } else {
                            sh = Math.floor(sw * 3 / 4); // 縦長画像：下側をカット
                        }
                    }
                    // クロップもリサイズもなし → 元データをそのまま返す
                    if (!force43 && !targetW) { res(e.target.result); return; }
                    // リサイズ幅を決定（4:3後の横幅が基準）
                    let dw = sw, dh = sh;
                    if (targetW && dw > targetW) {
                        dh = Math.round(sh * targetW / sw);
                        dw = targetW;
                    }
                    const c = document.createElement('canvas');
                    c.width = dw; c.height = dh;
                    c.getContext('2d').drawImage(i, 0, 0, sw, sh, 0, 0, dw, dh);
                    res(c.toDataURL('image/jpeg', 0.8));
                };
            };
        });
    },

    // ---- リサイズ＋EXIFからGPS読み込み ----
    resizeAndReadExif(f, targetW, force43) {
        return new Promise((res) => {
            const r = new FileReader();
            r.readAsDataURL(f);
            r.onload = (e) => {
                const originalDataUrl = e.target.result;
                let lat = null, lng = null;
                try {
                    if (typeof piexif !== 'undefined') {
                        const exif = piexif.load(originalDataUrl);
                        const gps  = exif['GPS'];
                        if (gps && gps[piexif.GPSIFD.GPSLatitude]) {
                            const toDec = (dms) => dms[0][0]/dms[0][1] + dms[1][0]/dms[1][1]/60 + dms[2][0]/dms[2][1]/3600;
                            lat = toDec(gps[piexif.GPSIFD.GPSLatitude])  * (gps[piexif.GPSIFD.GPSLatitudeRef]  === 'S' ? -1 : 1);
                            lng = toDec(gps[piexif.GPSIFD.GPSLongitude]) * (gps[piexif.GPSIFD.GPSLongitudeRef] === 'W' ? -1 : 1);
                        }
                    }
                } catch(e) { /* EXIFなしは無視 */ }
                const i = new Image();
                i.src = originalDataUrl;
                i.onload = () => {
                    let sw = i.width, sh = i.height;
                    if (force43) {
                        const w43 = Math.floor(sh * 4 / 3);
                        if (w43 < sw) sw = w43; else sh = Math.floor(sw * 3 / 4);
                    }
                    if (!force43 && !targetW) { res({ dataUrl: originalDataUrl, lat, lng }); return; }
                    let dw = sw, dh = sh;
                    if (targetW && dw > targetW) { dh = Math.round(sh * targetW / sw); dw = targetW; }
                    const c = document.createElement('canvas');
                    c.width = dw; c.height = dh;
                    c.getContext('2d').drawImage(i, 0, 0, sw, sh, 0, 0, dw, dh);
                    res({ dataUrl: c.toDataURL('image/jpeg', 0.8), lat, lng });
                };
            };
        });
    },

    // ---- 方位を現在の写真に記録 ----
    recordAzimuth() {
        if (this.currentIndex === -1) {
            window.uiHelper && uiHelper.showToast("写真を選択してから記録してください"); return;
        }
        if (azimuthManager.currentAzimuth === null) {
            window.uiHelper && uiHelper.showToast("センサー値を取得中です。少し待ってから再度押してください"); return;
        }
        const az = azimuthManager.currentAzimuth;
        this.photos[this.currentIndex].azimuth = az;
        this.renderAzimuthField();
        window.uiHelper && uiHelper.showToast(`方位を記録しました: ${az}° ${azimuthManager._dir(az)}`);
    },

    clearAzimuth() {
        if (this.currentIndex === -1) return;
        this.photos[this.currentIndex].azimuth = null;
        this.renderAzimuthField();
        window.uiHelper && uiHelper.showToast("方位を削除しました");
    },

    // 【Phase 6.08】数字を打つたびにその場で8方位の文字を表示する（改修指示書Step2-⑤）。
    // 「撮影方向」欄は8方位（北・北東・東・南東・南・南西・西・北西）で表示する。
    // より細かい16方位（北北東等）はazimuthManager._dir()側（現在の方位のライブ表示・
    // 記録時のトースト通知）で使う。同じ枠を使い回すだけなので新規UI要素は追加していない。
    updateAzimuth(v) {
        if (this.currentIndex === -1) return;
        const trimmed = v.trim();
        const dirEl = document.getElementById('photo-azimuth-dir');
        if (trimmed === '') {
            this.photos[this.currentIndex].azimuth = null;
            if (dirEl) dirEl.textContent = '';
            return;
        }
        const num = parseFloat(trimmed);
        if (!isNaN(num)) {
            const az = Math.round(((num % 360) + 360) % 360);
            this.photos[this.currentIndex].azimuth = az;
            if (dirEl) dirEl.textContent = this._dir8(az);
        }
    },

    // 8方位の文字を返す（撮影方向欄の表示専用）
    _dir8(az) {
        const dirs = ["北","北東","東","南東","南","南西","西","北西"];
        return dirs[Math.floor(((az + 22.5) % 360) / 45)];
    },

    renderAzimuthField() {
        const inp = document.getElementById('photo-azimuth-input');
        const dir = document.getElementById('photo-azimuth-dir');
        if (!inp) return;
        const p = this.photos[this.currentIndex];
        if (!p || p.azimuth === null || p.azimuth === undefined) {
            inp.value = ''; if (dir) dir.textContent = '';
        } else {
            inp.value = p.azimuth;
            if (dir) dir.textContent = this._dir8(p.azimuth);
        }
    },

    // ---- GPSを現在の写真に記録 ----
    recordGps() {
        if (this.currentIndex === -1) {
            window.uiHelper && uiHelper.showToast("写真を選択してから記録してください"); return;
        }
        if (gpsManager.status === 'init' || gpsManager.lat === null) {
            window.uiHelper && uiHelper.showToast("GPS取得中です。少し待ってから再度押してください"); return;
        }
        const p = this.photos[this.currentIndex];
        p.lat         = gpsManager.lat;
        p.lng         = gpsManager.lng;
        p.gpsAccuracy = gpsManager.accuracy;
        this.renderGpsField();
        const accMsg = gpsManager.accuracy !== null ? `（誤差 ${gpsManager.accuracy}m）` : '';
        window.uiHelper && uiHelper.showToast(`GPS を記録しました ${accMsg}`);
    },

    clearGps() {
        if (this.currentIndex === -1) return;
        this.photos[this.currentIndex].lat         = null;
        this.photos[this.currentIndex].lng         = null;
        this.photos[this.currentIndex].gpsAccuracy = null;
        this.renderGpsField();
        window.uiHelper && uiHelper.showToast("GPS を削除しました");
    },

    // GPS記録欄を現在の写真に合わせて更新
    renderGpsField() {
        const el = document.getElementById('photo-gps-status');
        if (!el) return;
        const p = this.photos[this.currentIndex];
        if (!p || p.lat === null) {
            el.textContent = '未取得';
            el.style.color = '#aaa';
        } else if (p.gpsAccuracy !== null) {
            // 撮影時自動記録（精度あり）
            el.textContent = `${p.gpsAccuracy}m`;
            el.style.color = p.gpsAccuracy <= 30 ? '#27ae60' : '#e67e22';
        } else if (p.gpsFixed) {
            // 地図タップ修正済み
            el.textContent = `修正済み（${p.lat.toFixed(4)}°, ${p.lng.toFixed(4)}°）`;
            el.style.color = '#3498db';
        } else {
            // EXIFから読んだ場合（精度不明）
            el.textContent = '不明';
            el.style.color = '#e67e22';
        }
    },

    // ---- タグ更新 ----
    updateTag(newTag) {
        if (this.currentIndex === -1) return;
        if (newTag === '全景' || newTag === '近景') {
            const conflictIndex = this.photos.findIndex(p => p.tag === newTag);
            if (conflictIndex !== -1 && conflictIndex !== this.currentIndex) {
                if (confirm(`既に「${newTag}」があります。上書きしますか？`)) {
                    this.photos[conflictIndex].tag = '補足';
                } else { this.render(); return; }
            }
        }
        this.photos[this.currentIndex].tag = newTag;
        this.runSort();
    },

    // ---- タグ順ソート ----
    runSort() {
        const currentPhoto = this.photos[this.currentIndex];
        this.photos.sort((a, b) => {
            const s = { "全景": 1, "近景": 2, "補足": 3, "地図メモ": 4 };
            return (s[a.tag] || 99) - (s[b.tag] || 99);
        });
        if (currentPhoto) this.currentIndex = this.photos.indexOf(currentPhoto);
        // ソートで順番が変わるのでDBを全件同期
        photoStorage.syncAll(this.photos);
        this.render();
    },

    // ---- 並び替え（同タグ内のみ） ----
    move(direction) {
        if (this.currentIndex === -1) return;
        const targetIndex = this.currentIndex + direction;
        if (targetIndex < 0 || targetIndex >= this.photos.length) return;
        if (this.photos[this.currentIndex].tag !== this.photos[targetIndex].tag) {
            alert("異なるタググループ間では並び替えできません。"); return;
        }
        const temp = this.photos[this.currentIndex];
        this.photos[this.currentIndex] = this.photos[targetIndex];
        this.photos[targetIndex] = temp;
        this.currentIndex = targetIndex;
        // 並び替え後もDBを全件同期
        photoStorage.syncAll(this.photos);
        this.render();
    },

    // ---- 描画 ----
    render() {
        const d = document.getElementById('photo-display');
        const c = document.getElementById('photo-counter');
        const m = document.getElementById('photo-memo');
        const t = document.getElementById('photo-tag');
        if (this.photos.length === 0) {
            d.innerHTML = '<span style="color:#aaa;">No Image</span>';
            c.textContent = "0/0";
            if (m) m.value = "";
            if (t) t.value = "補足";
            this.renderAzimuthField();
            this.renderGpsField();
            this.currentIndex = -1;
            return;
        }
        if (this.currentIndex >= this.photos.length) this.currentIndex = this.photos.length - 1;
        const p = this.photos[this.currentIndex];
        if (p.dataUrl) {
            d.innerHTML = `<img src="${p.dataUrl}" style="width:100%;height:100%;object-fit:contain;">`;
        } else {
            d.innerHTML = '<span style="color:#aaa; font-size:0.8rem;">写真はJZIPを読み込んで復元してください</span>';
        }
        c.textContent = `${this.currentIndex + 1}/${this.photos.length}`;
        if (m) m.value = p.memo || "";
        if (t) t.value = p.tag || "補足";
        this.renderAzimuthField();
        this.renderGpsField();
    },

    next() { if (this.currentIndex < this.photos.length - 1) { this.currentIndex++; this.render(); } },
    prev() { if (this.currentIndex > 0)                      { this.currentIndex--; this.render(); } },

    delete() {
        if (this.currentIndex === -1 || !confirm("この写真を削除しますか？")) return;
        this.photos.splice(this.currentIndex, 1);
        if (this.currentIndex >= this.photos.length) this.currentIndex = this.photos.length - 1;
        // 削除後もDBを全件同期（インデックスが変わるため全件上書き）
        photoStorage.syncAll(this.photos);
        this.render();
        this.updateHeaderSummary();
    },

    updateMemo(v) { if (this.currentIndex !== -1) this.photos[this.currentIndex].memo = v; },

    // ---- 位置情報を地図タップで修正 ----
    // 写真タブを閉じて位置図タブを開き、GPS修正モードを起動する
    modifyGps() {
        if (this.currentIndex === -1) {
            window.uiHelper && uiHelper.showToast("写真を選択してから修正してください"); return;
        }
        const photoIndex = this.currentIndex;

        // 写真タブを閉じる
        const photoItem    = document.querySelector('.accordion-item[data-group="photo-area"]');
        const photoContent = photoItem ? photoItem.querySelector('.accordion-content') : null;
        const photoIcon    = photoItem ? photoItem.querySelector('.icon') : null;
        if (photoContent) photoContent.style.display = 'none';
        if (photoIcon)    photoIcon.textContent = '+';

        // 位置図タブを開く
        const mapItem    = document.querySelector('.accordion-item[data-group="map-area"]');
        const mapContent = mapItem ? mapItem.querySelector('.accordion-content') : null;
        const mapIcon    = mapItem ? mapItem.querySelector('.icon') : null;
        if (mapContent) mapContent.style.display = 'block';
        if (mapIcon)    mapIcon.textContent = '-';

        // 地図を初期化してスクロール
        window.mapApp.init();
        if (mapItem) mapItem.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // GPS修正モード開始（少し遅延させて地図の描画を待つ）
        setTimeout(() => { window.mapApp.startGpsFixMode(photoIndex); }, 400);
    },

    // 地図タップで確定した座標を写真に適用
    applyGpsFix(lat, lng) {
        const photoIndex = window.mapApp._gpsFixPhotoIndex;
        if (photoIndex === null || photoIndex >= this.photos.length) return;

        this.photos[photoIndex].lat         = lat;
        this.photos[photoIndex].lng         = lng;
        this.photos[photoIndex].gpsAccuracy = null;
        this.photos[photoIndex].gpsFixed    = true;

        // 位置図タブを閉じて写真タブを開く
        const mapItem    = document.querySelector('.accordion-item[data-group="map-area"]');
        const mapContent = mapItem ? mapItem.querySelector('.accordion-content') : null;
        const mapIcon    = mapItem ? mapItem.querySelector('.icon') : null;
        if (mapContent) mapContent.style.display = 'none';
        if (mapIcon)    mapIcon.textContent = '+';

        const photoItem    = document.querySelector('.accordion-item[data-group="photo-area"]');
        const photoContent = photoItem ? photoItem.querySelector('.accordion-content') : null;
        const photoIcon    = photoItem ? photoItem.querySelector('.icon') : null;
        if (photoContent) photoContent.style.display = 'block';
        if (photoIcon)    photoIcon.textContent = '-';

        this.currentIndex = photoIndex;
        this.render();
        if (photoItem) photoItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.uiHelper && uiHelper.showToast("位置情報を修正しました");
    },

    // キャンセル時に写真タブを復元する
    _restorePhotoTab() {
        const photoItem    = document.querySelector('.accordion-item[data-group="photo-area"]');
        const photoContent = photoItem ? photoItem.querySelector('.accordion-content') : null;
        const photoIcon    = photoItem ? photoItem.querySelector('.icon') : null;
        if (photoContent) photoContent.style.display = 'block';
        if (photoIcon)    photoIcon.textContent = '-';

        const mapItem    = document.querySelector('.accordion-item[data-group="map-area"]');
        const mapContent = mapItem ? mapItem.querySelector('.accordion-content') : null;
        const mapIcon    = mapItem ? mapItem.querySelector('.icon') : null;
        if (mapContent) mapContent.style.display = 'none';
        if (mapIcon)    mapIcon.textContent = '+';

        if (photoItem) photoItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    updateHeaderSummary() {
        const s = document.querySelector('.accordion-item[data-group="photo-area"] .summary-text');
        if (s) {
            s.textContent = `${this.photos.length}枚`;
            s.classList.toggle('filled', this.photos.length > 0);
            s.classList.toggle('empty', this.photos.length === 0);
        }
    }
};

// =============================================================================
// 写真アコーディオンを開いたときに GPS・センサーを起動するフック
// =============================================================================
document.addEventListener('click', (e) => {
    const header = e.target.closest('.accordion-header');
    if (!header) return;
    const item = header.parentElement;
    if (!item || item.dataset.group !== 'photo-area') return;
    const content = header.nextElementSibling;
    if (content && content.style.display !== 'block') {
        gpsManager.start();
        // startListening()完了後に_updateLiveUI()を呼ぶことで
        // 初回起動時もセンサー値があれば即座に表示される
        azimuthManager.startListening().then(() => {
            azimuthManager._updateLiveUI();
        });
    }
});
