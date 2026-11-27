# 飛機模型建模者手冊（V2）

> 本文件是飛機模型編輯器與遊戲端共用的建模規範。編輯器端副本位於 `editor/docs/aircraft-visual-format.md`；遊戲端副本位於 `docs/aircraft-visual-format.md`。兩份內容應同步維護。

## 1. 先理解座標：所有尺寸以公尺計

模型使用飛機本體座標，不是 Three.js 預設的「Z 軸向前」：

| 軸 | 正方向 | 建模用途 |
|---|---|---|
| +X | 機首／前方 | 機鼻、前機身、儀表板 |
| -X | 機尾／後方 | 尾錐、發動機、尾翼 |
| +Y | 上方 | 機背、垂直尾翼、座艙頂部 |
| -Y | 下方 | 機腹、起落架方向 |
| +Z | 飛機右側 | 右機翼、右側控制台 |
| -Z | 飛機左側 | 左機翼、左側控制台 |

所有長度、位置和縮放都以公尺為單位；旋轉使用弧度。不要把「前方」誤設為 +Z，也不要把機翼左右方向放到 X 軸。

## 2. V2 檔案結構

每架飛機的專屬模型放在：

`src/aircraft/visuals/<aircraft-key>.json`

基本結構：

```json
{
  "version": 2,
  "name": "Aircraft display name",
  "aircraftKey": "aircraft-key",
  "components": [
    { "id": "aircraft-root", "name": "飛機本體" },
    { "id": "component-fuselage", "name": "機身", "parent": "aircraft-root" }
  ],
  "parts": [
    {
      "id": "fuselage-shell",
      "componentId": "component-fuselage",
      "shape": "cylinder",
      "radiusTop": 0.3,
      "radiusBottom": 0.4,
      "height": 6.2,
      "rotation": [0, 0, -1.5707963]
    }
  ]
}
```

- `version` 必須是 `2`。
- `components` 是階層節點；必須只有一個根節點，建議 ID 固定為 `aircraft-root`。
- `parts` 是實際幾何；每個 part 必須指定存在的 `componentId`。
- `aircraftKey` 必須與 `src/aircraft/data/*.json` 的 `key` 一致。
- ID 必須唯一且穩定。不要依賴清單順序來識別零件。

## 3. Component 與 Part 的分工

**Component 是組件／樞軸，Part 是幾何細節。**

建議階層：

- `aircraft-root`
  - `fuselage`
  - `nose`
  - `left-wing`、`right-wing`
  - `tail`
  - `cockpit-interior`
    - `pilot-seat`
    - `instrument-panel`
    - `hud`
    - `control-stick`
    - `cockpit-canopy`

一個組件可以包含多個 Part。需要一起移動、旋轉或動畫的零件應放在同一個 Component 底下。組件的位置是相對父組件的位置；Part 的位置則是相對所屬 Component 的局部位置。不要為了方便把所有幾何都堆在根節點，也不要把整架飛機拆成互不相關的根組件。

## 4. 機身與機翼建模順序

1. 建立機身主體，確認機首朝 +X。
2. 建立機鼻，放在機身前方；尾錐和發動機放在 -X 一側。
3. 建立左右機翼：左翼通常使用 -Z，右翼使用 +Z。可先完成一側，再沿 Z 軸鏡像。
4. 建立水平尾翼與垂直尾翼。垂直尾翼應主要向 +Y 延伸。
5. 再建立座艙、座艙罩、起落架艙門等細節。
6. 從正面、側面、俯視與斜視角檢查比例，確認沒有零件重疊或離開機體。

機翼輪廓通常使用 `polygon`，`plane: "xz"`；垂直尾翼可使用 `plane: "xy"`。擠出厚度由 `depth` 控制。圓柱的預設長軸是 Y 軸，若要沿機身 X 軸延伸，通常需要繞 Z 軸旋轉約 -90°。

## 5. 座艙與飛行員視點（最重要）

飛行視角的攝影機固定在飛行員眼點；它不是機體原點，也不是機鼻位置。模型的座椅、頭枕、儀表板、HUD 和座艙罩必須圍繞同一個眼點安排。

目前共用座艙範本的參考位置（機體座標、公尺）：

| 部件 | 建議位置／範圍 |
|---|---|
| 座椅坐墊中心 | 約 `[-0.62, 0.06, 0]` |
| 座椅靠背中心 | 約 `[-0.90, 0.50, 0]` |
| 頭枕中心 | 約 `[-1.01, 1.00, 0]` |
| 儀表板中心 | 約 `[0.88, 0.48, 0]` |
| HUD 中心 | 約 `[1.22, 0.92, 0]` |
| 座艙罩中心 | 約 `[0, 0.67, 0]` |
| 飛行員眼點 | 約 `[-0.72, 1.05, 0]` |

這些是目前範本的校準起點，不是所有機型都必須照抄。每架飛機都應依座椅實際位置微調眼點。

**眼點設定位置：** `src/aircraft/data/<aircraft-data-file>.json` 的 `cockpit.eyeOffset`，格式為 `[x, y, z]`。這個欄位屬於機型設定，不是 V2 視覺 JSON 的 `parts` 欄位。

例如：

```json
"cockpit": {
  "eyeOffset": [-0.72, 1.05, 0],
  "fovDeg": 70
}
```

校準原則：

- X 必須落在座椅附近，通常略在頭枕前方；絕不可把正值機鼻座標當成眼點。
- Y 應高於坐墊，接近坐姿飛行員眼睛高度。
- Z 通常為 0，除非駕駛位置本來就偏向一側。
- 從眼點看出去，儀表板應在前下方，HUD 位於前方視線附近，座椅與頭枕應在身後，座艙罩應包覆頭部周圍。
- 若回頭時完全看不到座椅／頭枕，先檢查眼點和座椅位置，不要用 CSS 假造座艙。

## 6. 編輯器操作流程

1. 開啟飛機模型編輯器，在模型名稱旁輸入模型名稱及正確的 `機型 Key`。
2. 先保留唯一根組件 `aircraft-root`，再建立機身、機翼、尾翼與座艙等 Component。
3. 選取所屬 Component，再新增 Box、Cylinder、Cone、Sphere、Torus 或 Polygon 等 Part。
4. 以局部座標調整 Part 的位置、旋轉和尺寸；需要成組移動或動畫的零件應先建立 Component。
5. 使用格線和座標軸檢查方向；拖曳模型從正面、側面、上方和內部檢查。
6. 建立座艙時可使用「建立座艙內飾」作為起點，再調整座椅、儀表、HUD、操縱桿、側台與座艙罩。
7. 使用動畫測試台逐一檢查已綁定的動畫通道。
8. 按「複製 JSON」，將匯出內容存為 `src/aircraft/visuals/<aircraft-key>.json`。
9. 到對應的 `src/aircraft/data/*.json` 校準 `cockpit.eyeOffset`；確認眼點與座椅對齊後再進行遊戲內測試。

## 7. 可用幾何與材質欄位

支援形狀：`box`、`cylinder`、`hollowCylinder`、`cone`、`sphere`、`torus`、`polygon`。

常用欄位：

- 幾何尺寸：`width`、`height`、`depth`、`radius`、`radiusTop`、`radiusBottom`、`innerRadius`、`tube`
- 位置與姿態：`position`、`rotation`、`scale`
- 材質：`color`（`#RRGGBB`）、`metalness`、`roughness`、`opacity`、`visible`
- 多邊形：`vertices`、`plane`、`depth`

材質的 `metalness`、`roughness`、`opacity` 範圍均為 0 到 1。幾何尺寸必須是大於 0 的有限數值。

## 8. 動畫綁定

動畫寫在 Component 的 `animation`：

```json
{
  "channel": "pitch",
  "axis": "z",
  "min": -0.16,
  "max": 0.16
}
```

- 通道：`pitch`、`roll`、`yaw`、`gear`、`flaps`、`canopy`
- 軸：`x`、`y`、`z`
- `min`、`max` 是相對基準姿態的旋轉偏移，單位為弧度。
- Component 原點應放在實際轉軸；不要把樞軸放在零件幾何中心以外卻忘記調整局部位置。

動畫測試台用來確認方向和行程。動畫只影響視覺節點，不改變飛行物理。

## 9. 匯入、匯出與生成規則

- 編輯器匯出必須是 V2。
- 將檔案命名為 `<aircraft-key>.json`，並放進 `src/aircraft/visuals/`。
- 專屬視覺 JSON 會優先於程序生成模型。
- `scripts/generate-visual-assets.mjs` 會在開發、建置與 Pages CI 前，為尚無專屬檔案的機型生成 V2 預設模型；已存在的手工模型不會被覆蓋。
- 不要把模型幾何欄位塞進飛行物理的 `physics` 區塊。
- 不要以 CSS 形狀代替真正的 3D 座艙零件。

## 10. 完成前檢查清單

- [ ] 機首朝 +X、上方朝 +Y、右翼朝 +Z。
- [ ] 只有一個根組件，所有 Component 都有有效父節點。
- [ ] 每個 Part 都有有效且唯一的 ID 與 `componentId`。
- [ ] 機身、機翼、尾翼、發動機與座艙零件分離且位置合理。
- [ ] 座椅、頭枕、儀表板、HUD 和座艙罩彼此對齊。
- [ ] `cockpit.eyeOffset` 位於座椅上的飛行員眼睛位置，而不是機鼻。
- [ ] 動畫樞軸與方向正確。
- [ ] 匯出 JSON 可由遊戲端共用載入器讀取。

## 11. 驗證

在遊戲專案根目錄執行：

```bash
npm run generate:visuals
npm test -- --run tests/aircraft-builder.test.ts
npm run build
```

V2 的結構驗證會拒絕多個根節點、孤兒組件、循環父子關係、重複 ID、孤兒 Part、無效幾何尺寸及不合法動畫欄位。完成建模後仍須在遊戲中實際檢查第一人稱座艙視角；通過 JSON 驗證不等於視覺比例已經校準。
