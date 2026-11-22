# combat-flight-simulator

瀏覽器內的戰鬥機飛行模擬引擎：Rust/WebAssembly 物理、固定 30 Hz 物理步長、60 FPS 以上的插值渲染、WebGPU 為主並以 WebGL 2 後備，第一人稱駕駛艙。

> **狀態：第一個交付版本（骨架可運行，尚未在真實環境完整驗證，見「驗證狀況」）**

## 快速開始

需求：Node.js 24+、Rust（<https://rustup.rs>）。

```bash
rustup target add wasm32-unknown-unknown
npm install          # 第一次請把產生的 package-lock.json 一併 commit
npm run dev          # 先編譯 WASM，再啟動 Vite
```

操作：`↑/↓` 俯仰（↓ = 拉桿抬頭）、`←/→` 滾轉、`A/D` 方向舵、`W/S` 油門、`R` 重置。
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
 │   線性插值位置 / Slerp 姿態                  └ Rust/WASM：6-DOF 剛體 + ISA 大氣 + 氣動模型
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

- 沒有起降：`y ≤ 0` 即判定墜毀（按 R 重置）。起始在 2000 m、180 m/s。
- 氣動係數是手調的「通用輕型戰鬥機」，**不是任何真實機型的資料**；沒有燃油、後燃器、地面效應、起落架。
- 30 Hz 插值讓畫面比物理狀態晚約 42 ms（`INTERP_DELAY_MS`）。對駕駛艙手感有影響，之後可讓視角輸入繞過插值。
- GPU 裝置遺失（WebGPU）與 WebGL context lost 目前只提示或停止繪製，沒有自動恢復。
- 未使用 WASM SIMD：單一剛體的 6-DOF 沒有向量化收益，等多機體或地形查詢進來再評估。
- Rust 端用單一全域 `static mut` 模擬實例（一個 worker 擁有一個實例，單執行緒下安全）；多實例需要改成 handle。
- `package.json` 沒有 lockfile，版本範圍為 `^`；請在本機 `npm install` 後 commit `package-lock.json`。
- 尚無遮蔽剔除（Occlusion Culling）、LOD、glTF 載入、地形分區：場景只有 4000 個實例化方塊。
- 沒有新手教學
- 機體面板未搭建
- 武器系統尚未搭建

## 進度與下一步

| 進度 | 狀態 |
|---|---|
| 1 骨架、Vite、TS、Actions | 完成（CI 已驗證） |
| 2 渲染比較場景 | 部分：兩後端 + 狀態列可比較，尚無自動化基準 |
| 3 Rust WASM + Worker | 完成（待編譯驗證） |
| 4 30 Hz 物理 + 插值渲染 | 完成 |
| 5 飛機模型與駕駛艙 | 部分：第一人稱攝影機 + HUD；尚無 3D 艙體、MFD、感測器攝影機 |
| 6 飛行場景 | 部分：天空、霧、網格地面、實例化障礙 |
| 7 多人介面 | 僅協定草案與 `NetworkClient` 介面 |
| 8 武器系統 | 尚未實作
| 9 機器人   | 尚未實作電腦操控的模擬玩家


下一階段建議：① 武器系統實作、地面地形破壞與機器人；② 地面接觸與起降；③ MFD 面板與離屏感測器攝影機（OffscreenCanvas）；④ glTF + Meshopt 載入與地形分區；⑤ 第二種機型驗證參數化設計
