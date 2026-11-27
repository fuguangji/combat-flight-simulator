# 飛機視覺資產格式（V2）

本文件定義模型編輯器與遊戲執行階段共用的資料契約。**唯一標準是 `src/aircraft/builder/modularAircraft.ts` 的 V2 schema 與 `normalizeAircraftVisualConfig()`。** 編輯器、機庫、圖鑑與飛行座艙不得各自維護另一套 JSON 解析器。

## 資產位置與機型識別

每個機型最多對應一個視覺 JSON：

`src/aircraft/visuals/<aircraft-key>.json`

`<aircraft-key>` 必須與 `src/aircraft/data/*.json` 中該機型的 `key` 完全一致。V2 可選填 `aircraftKey`；若有填寫，載入器會檢查它與檔名是否一致，避免把 A 機型模型套到 B 機型。

不要把視覺模型欄位放進 `aircraft/data/*.json` 的 `physics` 區塊。飛行物理資料與視覺資產分離。

## V2 結構

- `version`: 固定為 `2`
- `name`: 模型顯示名稱
- `aircraftKey`: 可選，機型 registry key
- `components`: 真正的父子組件階層；必須恰好一個根節點
- `parts`: 幾何細節；每個細節都必須指定有效的 `componentId`

組件可設定 `position`、`rotation`（弧度）、`scale` 與可選的 `animation`。幾何細節也可設定位置、旋轉、縮放、材質、透明度和幾何參數。

## 動畫資料

`animation` 欄位：

- `channel`: `pitch`、`roll`、`yaw`、`gear`、`flaps`、`canopy`
- `axis`: `x`、`y`、`z`
- `min`、`max`: 相對於組件基準姿態的旋轉偏移，單位為弧度

組件原點應放在預期轉軸。飛行控制的 `pitch/roll/yaw` 以 -1 到 1 輸入；`gear/flaps/canopy` 以 0 到 1 輸入。動畫只修改視覺節點，不修改飛行物理。

## 編輯器到遊戲的流程

1. 在模型編輯器輸入與目標機型相同的 `機型 Key`。
2. 編輯組件與細節，並用動畫測試台檢查各動畫通道。
3. 複製 JSON；匯出內容必須是 V2，所有細節都要有 `componentId`。
4. 將 JSON 存為 `src/aircraft/visuals/<aircraft-key>.json`，覆蓋或新增該機型的視覺資產。
5. 推送到 `main`；遊戲端的共用 `visualRepository` 會讀取、正規化、驗證並建立模型。

遊戲端的機庫與圖鑑使用同一個視覺載入器。飛行時的自訂座艙也使用同一份正規化設定，抽取 `cockpit-interior` 子樹並由共用動畫控制器驅動。沒有自訂座艙組件時，保留原本內建 CSS 儀表。

## 舊版 V1

V1 僅作為遷移輸入。遊戲載入時會透過同一個 normalizer 遷移成 V2；新編輯與匯出一律使用 V2。不要再新增 V1 資產。

## 驗證規則

載入器會拒絕：
- 多個根節點、孤兒組件、循環父子關係
- 重複或空白 ID、孤兒幾何細節
- 不支援的幾何形狀或動畫通道
- 非有限位置／旋轉／縮放與幾何尺寸
- 不合法的材質範圍、顏色、頂點與分段數
- JSON 內的 `aircraftKey` 與資產檔名不一致

選配視覺資產載入失敗時，機庫／圖鑑會記錄錯誤並回退程序模型；飛行座艙則保留內建儀表，不會讓整個遊戲啟動失敗。
