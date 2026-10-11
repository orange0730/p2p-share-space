# iOS App 規劃（Capacitor 包裝 + 動態島）

> 狀態：**網頁端已預留好接口，原生端範本已寫好但尚未在 Xcode 編譯驗證**。
> 等有 Mac 時，從「[Mac 第一天](#mac-第一天)」開始照做即可。

## 為什麼要包成 App

| 想要的功能 | 網頁 / PWA | 原生 App（Capacitor） |
| --- | --- | --- |
| 動態島 / 鎖定畫面即時動態 | ❌ 沒有對應 API | ✅ ActivityKit |
| iOS 分享選單（相簿 → 分享 → 共享空間） | ❌ iOS Safari 不支援 Web Share Target | ✅ Share Extension |
| 掃 QR Code 直接開 App | ❌ | ✅ Universal Links |
| 檔案存到「檔案」App / 相簿 | ⚠️ 依賴瀏覽器下載 | ✅ 原生分享面板 |
| 背景長時間保持連線 | ❌ | ❌（iOS 一樣會暫停背景 App，見[限制](#限制與風險)） |

React 程式碼幾乎完全沿用：Capacitor 用 WKWebView 載入 `dist/`，WebRTC 在 iOS 14.3 以上的 WKWebView 可正常使用。

---

## 已經預留好的部分（不需要 Mac）

| 檔案 | 作用 |
| --- | --- |
| `capacitor.config.json` | App ID `me.wudodo.p2pshare`、名稱「共享空間」、網頁目錄 `dist` |
| `package.json` → `npm run cap:sync` | 建置網頁並同步到原生專案 |
| `src/native/platform.js` | `isNativeApp()`；`PUBLIC_URL`：App 內的網址是 `capacitor://localhost`，QR Code 改用公開網址（可用環境變數 `VITE_PUBLIC_URL` 覆寫） |
| `src/native/liveActivity.js` | 透過 `registerPlugin('LiveActivity')` 呼叫原生端；`toLiveState()` 把空間狀態轉成動態島要顯示的內容 |
| `src/hooks/useLiveActivity.js` | 空間上線時 `start`，狀態變化時每秒最多 `update` 一次，離開或解散時 `end`；**網頁版完全不執行** |
| `src/lib/install.js` | App 內不顯示「加到主畫面」 |
| `native/ios/ShareSpaceAttributes.swift` | 即時動態的資料結構（App 與 Widget 共用） |
| `native/ios/LiveActivityPlugin.swift` | Capacitor Plugin：`start` / `update` / `end` |
| `native/ios/MyViewController.swift` | 註冊上面的 Plugin |
| `native/ios/ShareSpaceLiveActivity.swift` | 動態島（compact / expanded / minimal）與鎖定畫面的 SwiftUI 畫面 |

JS ↔ Swift 的資料對應：

```js
// start 時多帶 roomCode、role；update 只帶 ContentState
{ status: 'online', deviceCount: 3, transferName: 'video.mp4', transferDirection: 'up', progress: 0.45 }
```

---

## 你需要準備的

- **Mac**：可以執行最新版 Xcode 的 Mac（建議 Apple Silicon）
- **Apple ID**
  - 免費帳號：可以裝到自己的 iPhone，但每 7 天要重新安裝一次
  - **Apple Developer Program（每年 99 美元）**：TestFlight、App Store、Universal Links 都需要
- **測試機**：動態島需要 iPhone 14 Pro 以上；iOS 16.2 以上的其他 iPhone 會在鎖定畫面顯示即時動態
- **最低支援版本**：Capacitor 8 要求 iOS 15 以上；即時動態需要 iOS 16.2 以上，舊系統會自動略過

### 沒有自己的 Mac 的替代方案

- **租用雲端 Mac**（MacinCloud、AWS EC2 Mac 等，按小時計費）：第一次建立 Widget Extension Target 需要 Xcode 的圖形介面，建議至少租幾個小時把初始設定做完並推上 GitHub。
- **雲端建置**（Codemagic、GitHub Actions 的 macOS runner）：初始設定完成後，之後的建置與上傳 TestFlight 可以全自動，不需要再碰 Mac。

---

## Mac 第一天

### 1. 建立 iOS 專案

```bash
git clone https://github.com/orange0730/p2p-share-space.git
cd p2p-share-space
npm install
npm install @capacitor/ios
npx cap add ios
npm run cap:sync
npx cap open ios
```

> `npx cap add ios` 預設使用 Swift Package Manager。`ios/` 資料夾要 commit 進 git。

### 2. 先讓基本 App 跑起來

1. Xcode → `App` Target → **Signing & Capabilities**：選擇 Team，確認 Bundle Identifier 是 `me.wudodo.p2pshare`
2. 在模擬器與真機各跑一次，確認：建立空間、加入空間、傳文字、傳檔案都正常
3. 用另一台裝置開網頁版加入 App 開的空間（驗證 QR Code 指向 `https://wudodo.me/p2p-share-space/`）

### 3. 加入 Live Activity Plugin

1. 把 `native/ios/` 裡的這三個檔案拖進 Xcode 的 `App` 資料夾（勾選 *Copy items if needed*，Target 選 `App`）：
   - `LiveActivityPlugin.swift`
   - `MyViewController.swift`
   - `ShareSpaceAttributes.swift`
2. 打開 `Main.storyboard` → 選取 *Bridge View Controller* → Identity Inspector 的 **Custom Class** 改成 `MyViewController`
3. `App/Info.plist` 新增：`NSSupportsLiveActivities` = `YES`

### 4. 建立 Widget Extension（動態島畫面）

1. **File → New → Target… → Widget Extension**
   - Product Name：`ShareSpaceWidget`
   - 勾選 **Include Live Activity**；不勾 Configuration App Intent
   - 跳出「Activate scheme?」選 Activate
2. 刪掉 Xcode 產生的 Live Activity 範本，改放 `native/ios/ShareSpaceLiveActivity.swift`
3. 修改 Widget Bundle（`ShareSpaceWidgetBundle.swift`）只保留：
   ```swift
   @main
   struct ShareSpaceWidgetBundle: WidgetBundle {
       var body: some Widget {
           ShareSpaceLiveActivity()
       }
   }
   ```
4. 選取 `ShareSpaceAttributes.swift` → File Inspector 的 **Target Membership** 同時勾選 `App` 與 `ShareSpaceWidgetExtension`
5. Widget Extension 的 Deployment Target 設為 iOS 16.2

### 5. 驗證動態島

在 iPhone 14 Pro 以上建立空間 → 往上滑回主畫面，動態島應顯示「圖示 + 裝置數」。
從其他裝置傳一個大檔案，動態島右側應顯示百分比；長按可展開看到檔名與進度條。

---

## App 內與網頁版的差異（要調整的地方）

| 項目 | 問題 | 處理方式 | 優先度 |
| --- | --- | --- | --- |
| 儲存檔案 | WKWebView 不支援 `<a download>` | `@capacitor/filesystem` 寫入暫存檔，再用 `@capacitor/share` 叫出分享面板（可存到「檔案」或相簿）。改 `src/lib/utils.js` 的 `saveBlob()` | **必要** |
| 匯出 ZIP | 同上 | 同上（`exportZip` 最後也是呼叫 `saveBlob`） | **必要** |
| Service Worker | WKWebView 不支援，PWA 快取與網頁版分享選單在 App 內無效 | 不需處理（App 本身就是離線安裝的）；分享選單改做 Share Extension | — |
| Host 恢復 | App 被使用者滑掉後 sessionStorage 會消失；`beforeunload` 不會觸發 | App 內改用 localStorage 記住 Host 空間（例如 10 分鐘內重開就恢復） | 建議 |
| 回到前景 | 背景被暫停後 WebRTC 會斷 | 用 `@capacitor/app` 的 `resume` 事件：Host 檢查 Peer 是否還連著，Client 立即重連（現有自動重連多半已能處理） | 建議 |
| 剪貼簿 | `capacitor://localhost` 是安全來源，`navigator.clipboard` 通常可用 | 實測，不行再改用 `@capacitor/clipboard` | 驗證 |
| 外部連結 | 文字裡的網址要用 Safari 開 | Capacitor 預設會把外部網址交給系統瀏覽器；實測確認 | 驗證 |
| App 圖示 / 啟動畫面 | — | `npx @capacitor/assets generate`，來源用 `public/logo.svg` | 必要 |

---

## 動態島設計

```
收合（compact）
  ╭───────────────────────────────╮
  │ ⟁                          3  │   ⟁ 顏色＝狀態：綠 已連線 / 橘 重連中 / 紅 斷線
  ╰───────────────────────────────╯   有傳輸時右側改成「45%」

最小（minimal，和其他 App 同時顯示時）
  ( ⟁ )   有傳輸時改成圓形進度

展開（長按）
  ╭───────────────────────────────────────╮
  │ ⟁ #123456                       📱 3  │
  │ ⬆ vacation-video.mp4           45%   │
  │ ███████████░░░░░░░░░░░░░░             │
  ╰───────────────────────────────────────╯
  沒有傳輸時，下方顯示「● 主控中 / 已連線 / 重新連線中」
```

鎖定畫面顯示相同的資訊（不支援動態島的 iPhone 也看得到）。

---

## 後續階段

| 階段 | 內容 | 預估 |
| --- | --- | --- |
| **1. 基本 App** | 建立專案、簽章、`saveBlob` 原生化、圖示、真機測試 | 1 天 |
| **2. 動態島** | 套用本文件的範本、調整畫面、真機測試 | 0.5–1 天 |
| **3a. Share Extension** | iOS 分享選單：Extension 把檔案寫進 App Group 共用資料夾 → 開啟 App → 網頁端讀取後送進空間（沿用現有的 `pendingShare` 流程） | 1–2 天 |
| **3b. Universal Links** | 在 `wudodo.me/.well-known/apple-app-site-association` 放設定檔（要 Team ID，放在 `orange0730.github.io` repo，需加 `.nojekyll`）；App 加 Associated Domains | 0.5 天 |
| **4. 上架** | TestFlight → App Store 審核（截圖、隱私權說明：資料不經伺服器） | 數天（含審核） |

---

## 限制與風險

- **背景執行**：iOS 會在 App 進背景後很快暫停它，WebRTC 連線與傳輸都會中斷。動態島主要在前景，或剛切到背景的幾十秒內即時更新；之後會停在最後的狀態。若要背景更新，必須由伺服器發 APNs 推播，這違反「無後端」的設計，所以不做。可考慮用 `beginBackgroundTask` 爭取約 30 秒把進行中的傳輸收尾。
- **即時動態時長**：系統最多保留約 8 小時（之後在鎖定畫面再顯示最多 4 小時），長時間開著的空間會被系統結束，屬正常行為。
- **App Store 審核（Guideline 4.2 最低功能）**：單純把網頁包成 App 可能被拒。動態島、Share Extension、檔案整合這些原生功能能提高通過機率，建議至少完成階段 1 + 2 + 3a 再送審。
- **Swift 6 嚴格併發**：如果 Xcode 專案預設 Swift 6 語言模式，`LiveActivityPlugin.swift` 裡的 `Task` 可能出現 Sendable 相關錯誤。可把 Plugin 類別標成 `@MainActor`，或在 Build Settings 把 Swift Language Version 設為 5。
- **範本未經編譯**：`native/ios/` 的 Swift 檔是依照 Capacitor 8 與 ActivityKit 的 API 撰寫，但還沒在 Xcode 實際編譯，第一次建置可能需要小幅修正。

---

## 現在（沒有 Mac）還可以先做的

- `saveBlob()` 原生化：安裝 `@capacitor/filesystem`、`@capacitor/share`，在 `isNativeApp()` 時改走原生分享面板；網頁版行為不變，可以先寫好、等上機驗證。
- App 內的 Host 恢復改用 localStorage（只在 `isNativeApp()` 時生效）。
- 準備上架素材：App 說明文字、隱私權政策頁（可放在 GitHub Pages）、截圖規劃。
