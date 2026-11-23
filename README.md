# combat-flight-simulator

瀏覽器內的虛構高速航空器飛行與空中對抗模擬引擎：Rust/WebAssembly 物理、固定 30 Hz 物理步長、60 FPS 以上的插值渲染、WebGPU 為主並以 WebGL 2 後備，第一人稱駕駛艙。

> **狀態：第一個交付版本（骨架可運行，尚未在真實環境完整驗證，見「驗證狀況」）**

## 快速開始

需求：Node.js 24+、Rust（<https://rustup.rs>）。

```bash
rustup target add wasm32-unknown-unknown
npm install          # 第一次請把產生的 package-lock.json 一併 commit
npm run dev          # 先編譯 WASM，再啟動 Vite
```

開啟後先看到**主頁**（背景是緩慢環繞城市的攝影機），按「起飛」或 `Enter` / 空白鍵開始。
操作：`↑/↓` 俯仰（↓ = 拉桿抬頭）、`←/→` 滾轉、`A/D` 方向舵、`W/S` 油門、滑鼠環顧（點擊畫面鎖定滑鼠；不支援時按住左鍵拖曳）、`C` / 中鍵視角回正、`Esc`/`P` 暫停、`R` 重新開始。墜毀後會顯示結算卡（原因、飛行時間、撞擊速度、最大過載）。
網址加 `?backend=webgl2` 可強制使用 WebGL 2（用來比較兩個後端）。

其他指令：`npm test`（TS 測試，含 WASM 整合測試）、`npm run test:rust`（Rust 單元測試）、`npm run typecheck`、`npm run build`。

## 部署到 GitHub Pages（只用 `GITHUB_TOKEN`，不需要 PAT）

1. 建立 **Public** repository `combat-flight-simulator`，把本專案 push 到 `main`。
2. 到 **Settings → Pages → Build and deployment → Source**，選 **GitHub Actions**（只需做一次，這一步無法由 workflow 代勞）。
3. 之後每次 push 到 `main`，`.github/workflows/deploy.yml` 會依序執行：Rust 測試 → 編譯 WASM → 型別檢查 → TS 測試 → Vite 建置（`VITE_BASE=/<repo 名稱>/`）→ 部署。
4. `deploy` job 依賴 `build` job，任何一步失敗都不會執行部署，所以上一次成功的版本不會被覆蓋。Pull Request 只跑建置與測試，不部署。

網址通常是 `https://<你的帳號>.github.io/combat-flight-simulator/`。

## 架構

```
主執行緒                                   physics worker
────────                                   ──────────────
requestAnimationFrame (60+ Hz)             setInterval(5 ms) + FixedStepper (30 Hz)
 ├ 鍵盤 → 控制軸 ──── controls ──────────▶  sim_set_controls()
 ├ SnapshotBuffer.sample(now)  ◀─ snapshot ─  sim_step(1/30) → sim_snapshot() (Float64Array, transfer)
 │   Hermite 插值位置 / Slerp 姿態              └ Rust/WASM：6-DOF 剛體 + ISA 大氣 + 氣動模型 + 碰撞
 ├ 攝影機 = 駕駛員眼點（機體座標）
 ├ Renderer（WebGPU 或 WebGL 2）
 └ HUD（Canvas 2D，0 個 3D draw call）
```

| 目錄 | 職責 |
|---|---|
| `wasm/physics-engine` | Rust 物理核心（C ABI，無 wasm-bindgen、無匯入），含單元測試 |
| `workers/` | physics worker：持有 WASM 實例與 30 Hz 時鐘 |
| `src/core` | 設定常數、數學、固定步長累加器、能力偵測 |
| `src/physics` | 快照格式、插值緩衝區、worker 用戶端 |
| `src/rendering` | `Renderer` 介面、WebGPU / WebGL 2 後端、測試場景、動態解析度 |
| `src/cockpit` | 駕駛艙攝影機、姿態計算、HUD |
| `src/aircraft` | 機型定義（眼點、FOV；氣動參數在 Rust 端，以 `id` 對應） |
| `src/networking` | 多人協定草案與 `NetworkClient` 介面（第一版為離線實作） |
| `docs/PHYSICS.md` | 座標系、方程式、參數單位與假設 |

## 技術決策

- **物理與渲染完全分離**：物理只在 worker 內以固定 `1/30 s` 推進（內部再切成 ≤1/120 s 的子步驟）。累加器每次最多補 5 步、單次最多吸收 0.25 s，超過就丟棄多餘時間，所以過載時模擬變慢而不是卡死。分頁隱藏時暫停物理。
- **不依賴 SharedArrayBuffer**：GitHub Pages 無法送 COOP/COEP。快照用 `postMessage` + Transferable `ArrayBuffer`（每步 256 bytes）。`core/capabilities.ts` 已預留偵測，之後可在支援的主機上選用。
- **WASM 用純 C ABI**：只需要 `rustc` 與 `wasm32-unknown-unknown`，不需要 wasm-bindgen/wasm-pack，少一層版本相容問題。快照欄位表同時記錄在 `lib.rs` 與 `src/physics/stateLayout.ts`，並由 WASM 整合測試檢查。
- **渲染：自寫薄薄一層後端（暫定）**：整個場景只有天空、地面與一個實例化繪製，WebGPU / WebGL 2 各約 250 行、零依賴，方便實測兩個後端在整合式 GPU 上的差異。採相機相對座標（幾何先減去相機位置）避免遠距離 float32 抖動。**這是第一版的暫定選擇，不是最終結論**：等要載入 glTF/Meshopt/貼圖壓縮時，要用實測數據（`?backend=` 切換 + 左上角狀態列）再比較「繼續自寫」與 Three.js / Babylon.js / PlayCanvas，不會只因功能多就選。
- **動態解析度**：以 rAF 間隔的平滑值判斷，高於約 19.5 ms 降 5%（下限 50%），穩定後每約 4 秒試探性回升。注意它量到的是顯示節奏而非純 GPU 時間。
- **後處理**：預設完全沒有。

## 驗證狀況（請先讀）

已驗證完畢，成功部署。

## 已知問題與限制

- 沒有起降：機身任一碰撞點碰到地面（`y = 0`）或建築即判定墜毀。起始在 2000 m、180 m/s。碰撞是剛性判定（無損傷、無彈跳、無殘骸動畫）；機身以 7 個點的外殼近似，不是網格碰撞。
- `PULL UP` 已會模擬「改平＋以當下可用過載拉起」的逃脫軌跡，但仍是質點近似（不含阻力與推力變化、只考慮向上拉起，不考慮側向閃避）。
- 氣動係數是手調的「通用輕型戰鬥機」，**不是任何真實機型的資料**；已有燃油、後燃器、馬赫相依氣動與舵面作動器，但沒有地面效應、起落架、襟翼 / 減速板、風切。
- 30 Hz 插值讓畫面比物理狀態晚約 42 ms（`INTERP_DELAY_MS`）。對駕駛艙手感有影響，之後可讓視角輸入繞過插值。
- GPU 裝置遺失（WebGPU）與 WebGL context lost 目前只提示或停止繪製，沒有自動恢復。
- 未使用 WASM SIMD：單一剛體的 6-DOF 沒有向量化收益，等多機體或地形查詢進來再評估。
- Rust 端用單一全域 `static mut` 模擬實例（一個 worker 擁有一個實例，單執行緒下安全）；多實例需要改成 handle。
- `package.json` 沒有 lockfile，版本範圍為 `^`；請在本機 `npm install` 後 commit `package-lock.json`。
- 尚無遮蔽剔除（Occlusion Culling）、LOD、glTF 載入、地形分區：場景只有 4000 個實例化方塊。
- 新手教學只偵測狀態（不會替你重置位置）；中途墜毀按 R 重來會從第 1 步開始。
- 機體面板未搭建
- 裝備互動與飛行投射物玩法尚未搭建

## 進度與下一步

| 進度 | 狀態 |
|---|---|
| 1 骨架、Vite、TS、Actions | 完成（CI 已驗證） |
| 2 渲染比較場景 | 部分：兩後端 + 狀態列可比較，尚無自動化基準 |
| 3 Rust WASM + Worker | 完成（待編譯驗證） |
| 4 30 Hz 物理 + 插值渲染 | 完成 |
| 5 飛機模型與駕駛艙 | 部分：第一人稱攝影機 + HUD + 警告系統 / 警告音；尚無 3D 艙體、MFD、感測器攝影機 |
| 6 飛行場景 | 部分：天空、霧、網格地面、實例化障礙 |
| 7 多人介面 | 僅協定草案與 `NetworkClient` 介面 |
| 8 裝備與飛行投射物 | 尚未實作；待建立原創遊戲裝備、可操作的發射流程、獨立飛行物件、碰撞與命中判定 |
| 9 AI 航空器 | 尚未實作電腦操控的模擬玩家 |
| 10 雷達與目標資訊 | 尚未實作雷達面板、目標標記、選取及遊戲內追蹤狀態 |
| 11 空中對抗與任務模式 | 尚未實作對抗狀態、任務目標、完成條件及結算 |
| 12 多機型 | 尚未實作第二種機型與可擴充的機型參數配置 |

下一階段建議（以下均為遊戲內原創、虛構的互動機制）：① 建立裝備互動玩法：可操作的發射流程、獨立飛行投射物、遊戲內目標關聯狀態、碰撞與命中判定；② 建立 AI 航空器及空中對抗狀態；③ 建立雷達、目標選取 / 資訊追蹤介面與 MFD，必要時加入離屏感測器攝影機（OffscreenCanvas）；④ 建立任務框架、任務目標、勝負條件及結算；⑤ 完成 3D 駕駛艙、glTF + Meshopt 載入與地形分區；⑥ 加入第二種原創機型，驗證機型參數化設計；⑦ 地面接觸與起降；⑧ 再評估多人同步及地形互動。

## 變更紀錄

### 自由視角（2026-11-23）
- 滑鼠可環顧駕駛艙：點擊畫面鎖定滑鼠（Esc 解除並暫停）；瀏覽器拒絕鎖定時改為按住左鍵拖曳、放開自動回正。 `C` 或中鍵回正。範圍：左右 ±150°、上 85° / 下 60°。
- 只轉動視角，**飛機操控仍以機首為準**（滑鼠不參與控制；鍵盤控制軸與物理完全不變）。
- HUD：轉頭時俯仰梯隱藏，機首十字與飛行路徑標記會依視角在螢幕上移動，下方顯示 `LOOK yaw / pitch`。航向帶、速度、高度等讀數不變。
- 程式：`src/ui/look.ts`（`FreeLook`）、`camera.ts` 的 `applyLook` / `bodyDirToView`、`tests/look.test.ts`。
- 限制：沒有 3D 座艙或座艙蓋，所以向後看只看到天空 / 地面；機尾後方沒有機體遮擋。

### 新手教學（2026-11-23）
- 主頁新增「新手教學」：10 個步驟（俯仰 → 改平 → 滾轉 → 改正 → 油門 → 後燃器 → 收油門 → AOA 警告 → PULL UP 警告 → 改出），每步需維持條件一小段時間才算完成；`N` 略過目前步驟；低空或 PULL UP 時顯示提醒。
- 邏輯在 `src/ui/tutorial.ts`（只讀快照，無物理狀態），測試在 `tests/tutorial.test.ts`。
- 驗證：以最小 harness 執行 6 項測試（沙盒沒有 vitest）全過；推到 GitHub 後由 CI 的 vitest 再確認。瀏覽器實際畫面未看過。

### 物理模型升級與警告系統（2026-11-22，第二輪）

**物理**（`flight.rs`、`aircraft.rs`；細節見 `docs/PHYSICS.md`）
- 積分改為 RK4（仍是 4 個 1/120 s 子步，逐位元可重現）。
- 馬赫相依：升力斜率（Prandtl-Glauert → 跨音速平台 → 超音速衰減）、波阻（M 0.85 起、1.1 峰值）、超音速時氣動中心後移（更穩、舵效略降）。
- 引擎：慣性延遲（加速 1.1 s / 減速 0.7 s）、推力隨密度與馬赫變化、油門 > 0.85 進入後燃器（120 kN）、怠速 5 %。
- 燃油 3000 kg：依推力與比油耗消耗，質量與慣量隨之變化；油盡熄火。
- 舵面一階作動器（τ = 70 ms）；新增慣量積 Ixy、反向偏航、方向舵滾轉、偏航率滾轉耦合。
- 飛控保護：G 限制（+9 / −3 g，含俯仰率預測項）與迎角限制（失速角的 95 %），拉桿時才介入；仍可因低速而失速。
- 可選的確定性紊流與固定風（`Sim.turbulence`、`Sim.wind`，預設關閉）。

**警告**（`warnings.rs`、`src/physics/warnings.ts`、`src/ui/audio.ts`、`hud.ts`）
- 14 種警告以位元遮罩輸出、依優先序排列、分三級（紅 / 琥珀 / 綠）：PULL UP、STALL、OVERSPEED、ENGINE FLAMEOUT、OVER G、TERRAIN、SINK RATE、AOA、SPEED、BANK ANGLE、FUEL LOW、LOW ALT、G LIMIT、BINGO FUEL。
- `PULL UP` 只在「直線會撞，且以可用過載改平拉起仍會撞」時觸發；拉起仍可避開時只顯示 `TERRAIN`。
- HUD：主警告、其餘警告堆疊、紅色警告閃爍邊框、燃油 / 後燃器 / 限制器指示；WebAudio 警告音（連續、快、慢、提示音）。
- 快照 **API 2 → 3**，`STATE_LEN` 32 → 40（新增欄位 27–36）。

**未做**：裝備互動、飛行投射物玩法及 AI 航空器——這一輪沒有實作，仍是待辦。

**驗證狀況**：`cargo test` 52 項全過（含 12 項新物理測試、10 項警告測試）；TypeScript 型別檢查無自己檔案的錯誤（缺少的套件型別除外）。**未驗證**：WASM 建置（沙盒沒有 wasm32 目標且無網路）、`vitest`（含更新後的 WASM 整合測試與新的 `tests/warnings.test.ts`）、瀏覽器畫面、警告音與手感；氣動係數的新增項（Ixy、耦合、馬赫修正）是手調值，尚未在實機感受上調整。

### 主頁、動畫、碰撞（2026-11-22）

**主頁與流程**（`index.html`、`src/ui/style.css`、`src/ui/attract.ts`、`src/main.ts`）
- 啟動後停在主頁：高空緩慢環繞的攝影機、機型 / 起始條件 / 渲染後端、可展開的操作說明。物理在主頁與暫停時完全停止。
- 狀態機 `loading → menu → flying ⇄ paused`、`flying → crashed → (restart | menu)`；切換時黑幕淡入淡出。
- `Esc`/`P` 暫停（分頁隱藏時自動暫停）；墜毀 1.5 秒後出現結算卡。

**動畫**
- 位置改用三次 Hermite 插值（以快照速度為切線），30 Hz 快照交界處不再有折角；快照延遲時最多外插 100 ms（`MAX_EXTRAPOLATION_MS`）。碰撞那一步仍用線性插值（速度在該步突變為 0）。
- `CameraRig`：速度相關的視野（最多 +9 %）、G 力頭部下沉、引擎振動、穿音速與失速抖動、撞擊後衰減的震動與傾斜。
- HUD：飛行路徑標記（FPM）、撞擊倒數、撞擊瞬間閃光與暗角。
- 眼點被限制在地面以上，攝影機不會穿到地底。

**碰撞**（`wasm/physics-engine/src/collision.rs`、`flight.rs`）
- 畫面上的每棟建築現在都是實心的：worker 把渲染用的同一份實例陣列（`buildTestScene()`）上傳到 WASM（`sim_scene_alloc` / `sim_scene_commit`，**API 版本 1 → 2**），所以看得到的就是撞得到的。
- 7 點機身外殼（機頭、尾錐、兩翼尖、垂尾、機腹、座艙），每個子步以「線段 vs 膨脹 AABB」（slab 法）檢查，快速移動也不會穿牆；廣域用 1 km 均勻格網。
- 墜毀時停在第一次接觸的位置（不會嵌進牆裡）；快照新增墜毀原因（地面 / 建築）、墜毀時刻、預測撞擊時間（欄位 24–26）。
- 側傾時翼尖會比機身中心先擦地。

**驗證狀況（這一輪）**：沙盒沒有 Rust 工具鏈與 vitest。已驗證：TypeScript 型別（排除缺少的 `vite/client`、`@webgpu/types`、`@types/node`、`vitest` 型別宣告），以及插值 / 外插 / 攝影機基底 / 主頁攝影機高度的邏輯（編譯成 JS 後用 node 斷言檢查）。**未驗證**：`cargo test`（含新的碰撞測試）、`vitest`（含新的 WASM 整合測試）、瀏覽器實際畫面與手感。
