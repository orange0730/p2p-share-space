# P2P 共享空間

純前端、去中心化的跨裝置共享空間。開空間的裝置（Host）就是虛擬伺服器，其他裝置（Client）以星狀拓撲只連到 Host。

**線上版**：https://wudodo.me/p2p-share-space/

**技術棧**：Vite + React + Tailwind CSS v4 + Lucide React + PeerJS + qrcode.react + client-zip + vite-plugin-pwa

## 功能

- 建立 / 加入空間：6 位數代碼、QR Code 掃描直接加入
- 文字與連結：一鍵複製、網址自動轉超連結
- 檔案：拖曳、剪貼簿貼上、分塊傳輸並顯示進度
- 自訂裝置名稱：首頁或空間內的裝置清單都能修改，即時同步給所有人
- 匯出 ZIP：把空間內所有檔案與文字（合併成 `文字訊息.txt`）打包下載
- 全部清除：一鍵清空所有裝置上的內容
- PWA：可安裝到手機主畫面（Android 有安裝按鈕；iOS 會提示用 Safari「加入主畫面」）
- 系統分享選單（Android）：在相簿或任何 App 按「分享」→「共享空間」，內容會自動送進目前的空間
- Host 重新整理自動恢復：沿用同一個代碼與資料，Client 會自動重連；只有關閉分頁或按「解散」才會解散
- Client 自動重連：斷線後依 1→2→3→5…30 秒的間隔重試約 3 分鐘，回到前景或網路恢復時立即重試
- 取消傳輸：上傳與下載進度條旁都有取消按鈕
- 未讀提示：不在前景時，分頁標題顯示「(3) P2P 共享空間」，已安裝的 PWA 會在圖示上顯示數字

## 本機開發

```bash
npm install
npm run dev
```

> Windows PowerShell 若出現「已停用指令碼執行」，改用 `npm.cmd install` / `npm.cmd run dev`。

開發伺服器會對區網開放（`server.host: true`）。**Host 請用區網 IP 開啟**（例如 `http://192.168.1.20:5173`），QR Code 才能讓手機掃描開啟；用 `localhost` 開啟時，頁面上會顯示警告。

> 區網 http 下 WebRTC 可以正常運作；剪貼簿與 UUID 等需要安全來源的 API 已做好後備方案。正式部署建議使用 HTTPS（如 Vercel / Netlify / GitHub Pages）。

## 架構

```
          ┌──────────── Host（虛擬伺服器）────────────┐
          │  PeerJS ID = p2pspace-<6 位數代碼>          │
          │  IndexedDB：items（中繼資料）+ blobs（檔案）│
          └──────┬──────────────┬──────────────┬───────┘
         DataChannel     DataChannel     DataChannel
                 │              │              │
             Client A       Client B       Client C
```

| 檔案 | 職責 |
| --- | --- |
| `src/lib/hostEngine.js` | Host：註冊房間、接受連線、寫入 IndexedDB、轉發、回應檔案請求、關閉警告 |
| `src/lib/clientEngine.js` | Client：連線 Host、樂觀更新、上傳佇列、按需下載、斷線重連 |
| `src/lib/protocol.js` | 訊息協定、分塊編碼、背壓控制（`bufferedAmount` 高 / 低水位） |
| `src/lib/exportZip.js` | 匯出 ZIP（Client 會依序向 Host 取回尚未下載的檔案） |
| `src/lib/install.js` | PWA 安裝狀態（`beforeinstallprompt` / iOS 判斷） |
| `src/lib/storage.js` | IndexedDB 封裝，失敗時自動退回記憶體 Map |
| `src/lib/baseEngine.js` | 可被 `useSyncExternalStore` 訂閱的狀態容器、進度節流 |
| `src/components/*` | UI（首頁、標頭、配對面板、輸入區、項目卡片、拖曳覆蓋層） |

### 資料流

- **文字**：Client 送出 → Host 存入 IndexedDB → 廣播 `item-added` 給所有人（含送出者，用來確認樂觀項目）。
- **檔案上傳**：Client 送 `file-meta` 後，以分塊（依對端 `maxMessageSize` 決定，16–64 KB）送出；`bufferedAmount` 超過 4 MB 就暫停，降到 1 MB 才繼續，避免 DataChannel 緩衝區爆掉。Host 組回 Blob 並存檔後廣播。
- **轉發**：其他 Client 收到 `item-added` 後，20 MB 以下的檔案會自動向 Host 取回（即時可見），較大的檔案則按「下載」才傳。
- **新裝置加入**：Host 送出 `welcome`，內含完整的文字與檔案清單；5 MB 以下的圖片會自動取回作為預覽。
- **Host 卸載**：關閉 / 重新整理前會觸發 `beforeunload` 警告。卸載時送出 `host-leaving`，Client 進入自動重連；Host 重新整理後以 sessionStorage 記住的代碼與 IndexedDB 資料恢復空間。
- **解散**：按「解散空間」才送出 `room-closed`，Client 顯示「空間已解散」，資料庫一併刪除。
- **取消下載**：每次 `file-request` 帶一個新的 `rid` 當分塊標記，取消後立刻重新下載也不會混到上一次殘留的分塊。
- **儲存**：每個空間一個 IndexedDB（`p2p-room-<key>`），Host 每 20 秒寫一次心跳；超過 5 分鐘沒有心跳的資料庫（分頁被直接關掉）會在下次開啟時清除。

## 部署

推送到 `main` 分支後，GitHub Actions（`.github/workflows/deploy.yml`）會自動建置並發佈到 GitHub Pages。建置時以 `BASE_PATH=/<repo 名稱>/` 設定子路徑。

頁面會把公開網址的 http 自動導向 https（localhost 與區網 IP 除外）。建議同時在 Cloudflare 開啟「Always Use HTTPS」。由於網域經過 Cloudflare Proxy，GitHub Pages 無法自行簽發憑證，所以 GitHub 的「Enforce HTTPS」開不起來，這是正常的。

Service Worker 是自訂的 `src/sw.js`（vite-plugin-pwa 的 injectManifest 模式），負責預快取與接收分享選單的 POST。它採「不自動更新」：新版本會在所有分頁關閉後才生效，避免 Host 頁面被自動重新整理而解散空間。

圖示由 `public/logo.svg` 產生，修改後執行 `npx pwa-assets-generator` 重新產生 PNG。

## iOS App（規劃中）

預計用 Capacitor 包成 iOS App，加入動態島（即時動態）、iOS 分享選單與 Universal Links。網頁端的接口（`src/native/`）與原生端 Swift 範本（`native/ios/`）已經預留好，完整步驟見 [docs/ios-app-plan.md](docs/ios-app-plan.md)。

## 自架信令伺服器（選用）

預設使用 PeerJS 官方公用伺服器 `0.peerjs.com`（只負責交換連線資訊，不經手檔案內容）。若要自架，複製 `.env.example` 為 `.env.local` 並填入 `VITE_PEER_HOST` 等設定。

## 已知限制

- Host 是唯一的資料來源：Host 關閉分頁後空間即解散（重新整理不會）。
- 系統分享選單目前只有 Android Chrome 支援，iOS Safari 尚不支援 Web Share Target。
- 手機當 Host 時，切到背景或螢幕關閉可能使瀏覽器中斷連線（已使用 Wake Lock 盡量保持喚醒）。
- 瀏覽器不允許自訂 `beforeunload` 對話框文字，所以頁面上另有常駐提示說明「關閉將導致共享空間解散」。
- 對稱式 NAT / 嚴格防火牆下可能需要 TURN 伺服器（PeerJS 預設設定已包含公用 TURN）。
