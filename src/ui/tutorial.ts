import type { AircraftSnapshot } from '../physics/stateLayout';
import { attitudeFromQuat } from '../cockpit/camera';
import { radToDeg } from '../core/math';

/** AOA caution bit in the warning mask (see physics/warnings.ts). */
const WARN_AOA_BIT = 7;

/** One-shot things the pilot can do outside the flight model; reported by main.ts. */
export type TutorialEvent = 'look' | 'recenter' | 'waypoint' | 'contact' | 'focus' | 'fire' | 'landing-site';
/** Switches that are either on or off right now. */
export type TutorialFlag = 'map' | 'nav' | 'radar' | 'autopilot' | 'landingGuide';

export interface TutorialContext {
  s: AircraftSnapshot;
  /** Events that happened since the current step began. */
  seen: ReadonlySet<TutorialEvent>;
  flags: ReadonlySet<TutorialFlag>;
  waypoint: { x: number; z: number } | null;
}

export interface TutorialStep {
  id: string;
  title: string;
  hint: string;
  /** Replaces `hint` on touch devices. */
  touchHint?: string;
  /** `read` pages wait for "next" instead of a condition; the autopilot keeps the aircraft safe meanwhile. */
  kind?: 'action' | 'read';
  /** Bullet lines shown under the hint (mostly for `read` pages). */
  body?: readonly string[];
  /** Needs a keyboard (hidden on touch devices). */
  keyboardOnly?: boolean;
  /** Skipped for aircraft without an afterburner. */
  needsAfterburner?: boolean;
  /** True while the condition holds; the step completes after it has held for `hold` seconds. */
  test: (c: TutorialContext) => boolean;
  hold: number;
}

export interface TutorialChapter {
  id: 'controls' | 'setup' | 'knowledge';
  title: string;
  en: string;
  summary: string;
  steps: readonly TutorialStep[];
}

const attitude = (s: AircraftSnapshot) => {
  const a = attitudeFromQuat(s.orientation);
  return { pitch: radToDeg(a.pitch), roll: radToDeg(a.roll), heading: a.heading };
};

const never = (): boolean => false;
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Bearing (rad) from the aircraft to the waypoint, same convention as the navigation map. */
export function bearingTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(to.x - from.x, -(to.z - from.z));
}

// ---------------------------------------------------------------------------------------------
// Chapter 1: basic operation (keys / touch buttons)
// ---------------------------------------------------------------------------------------------
const CONTROLS: readonly TutorialStep[] = [
  {
    id: 'overview',
    kind: 'read',
    title: '操作總覽',
    hint: '先認識所有按鍵。閱讀期間自動駕駛會幫你維持高度與航向，按「下一頁」或 Enter 繼續。',
    body: [
      '↑ / ↓：俯仰（↓ 拉桿，機頭抬起）　← / →：滾轉',
      'A / D：方向舵　W / S：油門增減',
      '滑鼠拖曳：環顧（放開保持），C：視角回正',
      'M / V / B：開關地圖 / 導航 / 雷達　Esc 或 P：暫停　R：重新開始',
      '手機：左下四個方向鈕＝▲ 壓機頭、▼ 拉機頭、◀ ▶ 左右滾轉；右側滑桿＝油門；拖曳畫面＝環顧',
    ],
    test: never,
    hold: 0,
  },
  {
    id: 'pitch',
    title: '俯仰',
    hint: '按 ↓ 拉桿，讓機頭抬高到地平線上方約 10°（俯仰梯上的 10）。',
    touchHint: '按住左下 ▼ 拉機頭，讓機頭抬高到地平線上方約 10°（俯仰梯上的 10）。',
    test: ({ s }) => attitude(s).pitch > 10,
    hold: 0.3,
  },
  {
    id: 'level',
    title: '改平',
    hint: '按 ↑ 推回，讓機頭回到地平線附近（±4°），機翼保持水平。',
    touchHint: '按 ▲ 把機頭壓回地平線附近（±4°），機翼保持水平。',
    test: ({ s }) => {
      const a = attitude(s);
      return Math.abs(a.pitch) < 4 && Math.abs(a.roll) < 6;
    },
    hold: 1.5,
  },
  {
    id: 'roll',
    title: '滾轉',
    hint: '按 → 向右滾轉，直到飛機傾斜 45° 以上（HUD 上方的傾斜刻度會跟著轉）。',
    touchHint: '按住 ▶ 向右滾轉，直到飛機傾斜 45° 以上。',
    test: ({ s }) => Math.abs(attitude(s).roll) > 45,
    hold: 0.3,
  },
  {
    id: 'unroll',
    title: '改正傾斜',
    hint: '按 ← 把機翼改回水平（傾斜小於 6°）。',
    touchHint: '按 ◀ 把機翼改回水平（傾斜小於 6°）。',
    test: ({ s }) => Math.abs(attitude(s).roll) < 6,
    hold: 1.0,
  },
  {
    id: 'rudder',
    title: '方向舵',
    hint: '按住 A 或 D 讓機頭左右擺動（偏航）。方向舵用來修正側滑，轉彎主要靠滾轉＋拉桿。',
    keyboardOnly: true,
    test: ({ s }) => Math.abs(s.beta) > 0.02 || Math.abs(s.angularVelocity[1]) > 0.04,
    hold: 0.3,
  },
  {
    id: 'throttle',
    title: '油門',
    hint: '按住 W 把油門推到 80% 以上，觀察左下 THR 與速度尺的變化。',
    touchHint: '把右側滑桿往上推到 80% 以上，觀察 THR 與速度尺的變化。',
    test: ({ s }) => s.throttle >= 0.8,
    hold: 0.5,
  },
  {
    id: 'afterburner',
    title: '後燃器',
    hint: '把油門推到底（100%）點燃後燃器，HUD 會出現 AB。注意燃油消耗速度。',
    touchHint: '把滑桿推到最頂端（紅色區）點燃後燃器，HUD 會出現 AB。注意燃油消耗速度。',
    needsAfterburner: true,
    test: ({ s }) => s.afterburner,
    hold: 1.0,
  },
  {
    id: 'idle',
    title: '收油門',
    hint: '按住 S 把油門收到 40% 以下。',
    touchHint: '把滑桿往下拉到 40% 以下。',
    test: ({ s }) => s.throttle <= 0.4,
    hold: 0.5,
  },
  {
    id: 'look',
    title: '環顧',
    hint: '按住滑鼠左鍵拖曳來轉頭看四周。這只轉動視角，飛機仍以機首為準。',
    touchHint: '用手指在畫面空白處拖曳來轉頭看四周；放開後保持方向。',
    test: ({ seen }) => seen.has('look'),
    hold: 0.5,
  },
  {
    id: 'recenter',
    title: '視角回正',
    hint: '按 C（或滑鼠中鍵）讓視線回到機首方向。',
    touchHint: '點右上角 ⌖ 讓視線回到機首方向。',
    test: ({ seen }) => seen.has('recenter'),
    hold: 0,
  },
];

// ---------------------------------------------------------------------------------------------
// Chapter 2: basic setup (navigation, radar, autopilot)
// ---------------------------------------------------------------------------------------------
const SETUP: readonly TutorialStep[] = [
  {
    id: 'map-on',
    title: '開啟地圖',
    hint: '按 M，或點左上角「地圖」鈕。地圖顯示周圍的海洋、河流、森林與山地，▲ 是你的位置。',
    touchHint: '點左上角「地圖」鈕。地圖顯示周圍的海洋、河流、森林與山地，▲ 是你的位置。',
    test: ({ flags }) => flags.has('map'),
    hold: 0.4,
  },
  {
    id: 'nav-on',
    title: '開啟導航資料',
    hint: '按 V，或點「導航」鈕，顯示座標、航向、高度與航點距離，以及「下一航點」按鈕。',
    touchHint: '點「導航」鈕，顯示座標、航向、高度與航點距離，以及「下一航點」按鈕。',
    test: ({ flags }) => flags.has('nav'),
    hold: 0.4,
  },
  {
    id: 'waypoint',
    title: '設定航點',
    hint: '點導航面板的「下一航點」，地圖上橘色圓點就是新的目的地，虛線指向它。',
    test: ({ seen }) => seen.has('waypoint'),
    hold: 0,
  },
  {
    id: 'steer',
    title: '飛向航點',
    hint: '用滾轉＋拉桿轉向，讓航向對準航點方向（誤差 20° 內並維持 2 秒）。地圖上虛線在機頭正上方就是對準了。',
    test: ({ s, waypoint }) => {
      if (!waypoint) return false;
      const err = wrapPi(bearingTo({ x: s.position[0], z: s.position[2] }, waypoint) - attitude(s).heading);
      return Math.abs(err) < (20 * Math.PI) / 180;
    },
    hold: 2,
  },
  {
    id: 'radar-concepts',
    kind: 'read',
    title: '雷達與目標',
    hint: '雷達顯示訓練目標與降落信標；閱讀後會實際選取、鎖定及使用裝備。',
    body: [
      '接觸點分空中與地面／海面目標；雷達範圍和靈敏度可在駕駛艙設定。',
      '選取目標後按「鎖定」；空對空、空對地裝備必須搭配相符類別，並在有效雷達範圍內才能發射。',
      '按 F 或駕駛艙按鈕發射目前裝備，按住 G 使用機砲；這些是遊戲訓練效果，不代表真實武器操作。',
      '機場和航艦會以降落信標顯示在雷達；點選信標即可啟用進場導引。',
    ],
    test: never,
    hold: 0,
  },
  {
    id: 'radar-on',
    title: '開啟雷達',
    hint: '按 B，或點「雷達」鈕；右上角會顯示空中／地面訓練目標與機場／航艦信標。',
    touchHint: '點「雷達」鈕；右上角會顯示空中／地面訓練目標與機場／航艦信標。',
    test: ({ flags }) => flags.has('radar'),
    hold: 0.4,
  },
  {
    id: 'contact',
    title: '選取目標',
    hint: '在雷達清單點選一個空中或地面／海面接觸目標。',
    test: ({ seen }) => seen.has('contact'),
    hold: 0,
  },
  {
    id: 'focus',
    title: '鎖定目標',
    hint: '按目標旁的「鎖定」；鎖定有效且裝備用途相符時，才可發射。',
    test: ({ seen }) => seen.has('focus'),
    hold: 0,
  },
  {
    id: 'fire',
    title: '使用裝備',
    hint: '按 F 或駕駛艙的導彈按鈕使用目前裝備；按住 G 使用機砲。裝備有彈藥與冷卻，換裝請回主頁「裝備設定」。',
    test: ({ seen }) => seen.has('fire'),
    hold: 0,
  },
  {
    id: 'landing-site',
    title: '選取降落信標',
    hint: '在雷達右上角的 LANDING BEACONS 區，點選任一機場或 PETREL 航艦信標。',
    test: ({ seen }) => seen.has('landing-site'),
    hold: 0,
  },
  {
    id: 'landing-guide',
    title: '跟隨進場導引',
    hint: '信標會自動啟用導引。導航面板顯示進場線、跑道中線偏差 LOC、下滑道 G/S 與修正建議；HUD 也會顯示精簡提示。',
    test: ({ flags }) => flags.has('landingGuide'),
    hold: 0.5,
  },
  {
    id: 'autopilot-on',
    title: '自動駕駛',
    hint: '在駕駛艙面板扳動「自動駕駛」開關。它會維持高度、航向並改平機翼，適合閱讀資訊或喝口水。',
    test: ({ flags }) => flags.has('autopilot'),
    hold: 0.5,
  },
  {
    id: 'autopilot-off',
    title: '手動接管',
    hint: '再扳一次開關，或直接動任何操縱（方向鍵、油門）就會立刻接管。',
    test: ({ flags }) => !flags.has('autopilot'),
    hold: 0.5,
  },
  {
    id: 'panels-off',
    title: '收起面板',
    hint: '不用的時候把地圖與雷達關掉（M、B），避免擋住視線。導航資料較小，可以留著。',
    touchHint: '不用的時候點「地圖」「雷達」鈕關掉它們，避免擋住視線。',
    test: ({ flags }) => !flags.has('map') && !flags.has('radar'),
    hold: 0.4,
  },
];

// ---------------------------------------------------------------------------------------------
// Chapter 3: flight knowledge
// ---------------------------------------------------------------------------------------------
const KNOWLEDGE: readonly TutorialStep[] = [
  {
    id: 'hud',
    kind: 'read',
    title: '讀懂 HUD',
    hint: '閱讀期間自動駕駛接手飛行。按「下一頁」或 Enter 繼續。',
    body: [
      '左側刻度尺＝空速（KT），下方 M 是馬赫數；右側刻度尺＝高度（FT），下方 VS 是升降率（ft/min）。',
      '上方航向帶：N 北、E 東、S 南、W 西，中央方框是目前航向。',
      '中央俯仰梯：實線在地平線上方、虛線在下方；圓圈十字是機頭，帶短翼的圓圈是「飛行路徑標記」——飛機實際前進的方向。',
      '最上方的小弧形是傾斜角刻度，三角形指示目前滾轉角。',
    ],
    test: never,
    hold: 0,
  },
  {
    id: 'speed-aoa',
    kind: 'read',
    title: '速度、迎角與失速',
    hint: '速度不夠、拉得太猛，機翼都會失去升力。',
    body: [
      'AOA（迎角）是機翼與氣流的夾角。角度越大升力越大，但超過失速角就會失速（STALL）。',
      '飛控會在失速角前把拉桿量擋住，並顯示黃色 AOA 警告；速度太低時仍會失速。',
      '失速的處理：鬆桿、機頭放低換取速度、加油門，等速度回來再拉起。',
      '超速（OVERSPEED）同樣危險：收油門，並避免大過載機動。',
    ],
    test: never,
    hold: 0,
  },
  {
    id: 'g',
    kind: 'read',
    title: '過載（G）與燃油',
    hint: '每架飛機都有自己的過載與油量極限。',
    body: [
      'G 是座艙承受的過載。左下 G 數值接近機型上限會變黃、紅色；LIM 表示飛控正在限制你的拉桿量。',
      '轉彎時拉桿越用力，G 越高、速度掉得越快。',
      '後燃器推力大但耗油極快；燃油低於 25% 轉黃、低於 10% 轉紅，油盡引擎會熄火。',
      '想省油：用中等油門巡航，必要時才開後燃器。',
    ],
    test: never,
    hold: 0,
  },
  {
    id: 'warnings',
    kind: 'read',
    title: '警告系統',
    hint: '顏色代表緊急程度：紅色立刻處理，黃色注意，綠色提示。',
    body: [
      'PULL UP（紅）：照目前路徑連最大過載拉起都會撞上地形或建築，立刻拉桿。畫面上的 IMPACT 是直線預測的撞擊秒數。',
      'TERRAIN / SINK RATE（黃）：離地太近或下沉太快，還拉得起來，儘早處理。',
      'STALL、OVERSPEED、OVER G、ENGINE FLAMEOUT（紅）：機體狀態危險。',
      '警告會同時有聲音，音調越急促越緊急。',
    ],
    test: never,
    hold: 0,
  },
  {
    id: 'world',
    kind: 'read',
    title: '認識空域',
    hint: '世界是無邊際的程序化地貌，每次都一樣。',
    body: [
      '海洋與湖泊為深藍色，河流是蜿蜒的藍帶；岸邊有淺色沙灘，內陸有森林、沙漠與山地，高處覆雪。',
      '畫面上的方塊建築都是實心的，任何一點碰到都會墜毀；建築不會蓋在水上。',
      '地面的高低起伏目前只影響顏色，飛行高度以 y = 0 的水平面為準（高度 0 就是地面或海面）。',
      '用地圖（M）的色塊判斷前方地形，用導航的航點規劃路線。',
    ],
    test: never,
    hold: 0,
  },
  {
    id: 'landing',
    kind: 'read',
    title: '降落基礎',
    hint: '陸上機場與海上的航空母艦都能降落；母艦不具攻擊性，只是個浮動的跑道。',
    body: [
      '機場有長跑道，航空母艦的甲板短，要用更低的速度、更準的對正進場。航點清單與地圖會標示它們的位置。',
      '進場要點：收油門、保持機翼水平、機頭對準跑道中線，維持小角度下滑。',
      '安全接地條件：下沉率不超過 5 m/s、傾斜不超過 10°、速度不超過約 185 KT；超過就視為墜毀。',
      '接地後飛機自動滑行減速；母艦甲板有攔阻索，滑行距離很短。滑出甲板邊緣會落海。',
      '從雷達選取降落信標會啟用進場導引；LOC 顯示左右偏差，G/S 顯示相對 3° 下滑道的高度，並提供航向、速度及修正建議。',
    ],
    test: never,
    hold: 0,
  },
  {
    id: 'aoa',
    title: '實作：迎角警告',
    hint: '高度夠的時候（> 1000 m）持續拉桿，直到出現黃色 AOA 警告；飛控會擋在失速角之前。然後鬆桿。',
    touchHint: '高度夠的時候（> 1000 m）按住 ▼ 拉機頭，直到出現黃色 AOA 警告。然後放開。',
    test: ({ s }) => s.altitude > 1000 && (s.warnMask & (1 << WARN_AOA_BIT)) !== 0,
    hold: 0.3,
  },
  {
    id: 'terrain',
    title: '實作：地形警告',
    hint: '保持俯衝（↑）直到出現紅色 PULL UP，然後立刻拉桿（↓）改出。',
    touchHint: '按住 ▲ 俯衝，直到出現紅色 PULL UP，然後立刻按 ▼ 拉起。',
    test: ({ s }) => (s.warnMask & 1) !== 0,
    hold: 0.2,
  },
  {
    id: 'recover',
    title: '實作：改出',
    hint: '拉起後讓警告消失，並回到 1000 m 以上。',
    test: ({ s }) => s.altitude > 1000 && s.warnMask === 0,
    hold: 1.0,
  },
];

export const TUTORIAL_CHAPTERS: readonly TutorialChapter[] = [
  { id: 'controls', title: '基本操作', en: 'CONTROLS', summary: '按鍵與觸控：俯仰、滾轉、方向舵、油門、後燃器、環顧。', steps: CONTROLS },
  { id: 'setup', title: '基本設定', en: 'SETUP', summary: '地圖與導航、雷達目標類別與鎖定、進場信標、裝備與自動駕駛。', steps: SETUP },
  { id: 'knowledge', title: '基礎知識', en: 'KNOWLEDGE', summary: 'HUD 讀數、失速與過載、警告、地形與降落基礎，並實作警告改出。', steps: KNOWLEDGE },
];

/** Steps of a chapter that apply to this aircraft / input device. */
export function chapterSteps(chapter: TutorialChapter, opts: { afterburner: boolean; touch: boolean }): TutorialStep[] {
  return chapter.steps.filter((st) => (opts.afterburner || !st.needsAfterburner) && (!opts.touch || !st.keyboardOnly));
}

export interface TutorialView {
  index: number; // 0-based current step, == total when finished
  total: number;
  title: string;
  hint: string;
  touchHint: string;
  body: readonly string[];
  kind: 'action' | 'read';
  done: boolean;
  /** 0..1 progress of the dwell timer of the current step. */
  progress: number;
  /** The host should keep the autopilot engaged (reading pages). */
  wantsAutopilot: boolean;
  /** Extra line when the pilot is in danger in a step that does not expect it. */
  caution: string | null;
}

/** Guided checklist driven by the physics snapshots plus a few UI events (no extra physics state). */
export class Tutorial {
  private index = 0;
  private held = 0;
  private lastTime = -1;
  private seen = new Set<TutorialEvent>();
  private readonly flags = new Set<TutorialFlag>();
  private waypoint: { x: number; z: number } | null = null;

  constructor(private readonly steps: readonly TutorialStep[] = CONTROLS) {}

  reset(): void {
    this.index = 0;
    this.held = 0;
    this.lastTime = -1;
    this.seen.clear();
  }

  /** Report a one-shot event; it counts for the step that is current *now* and later. */
  note(e: TutorialEvent): void {
    this.seen.add(e);
  }

  setFlag(flag: TutorialFlag, on: boolean): void {
    if (on) this.flags.add(flag);
    else this.flags.delete(flag);
  }

  setWaypoint(wp: { x: number; z: number } | null): void {
    this.waypoint = wp;
  }

  private advance(): void {
    this.index++;
    this.held = 0;
    this.seen = new Set();
  }

  /** "Next page" on a reading step. */
  acknowledge(): void {
    if (this.steps[this.index]?.kind === 'read') this.advance();
  }

  /** Skip the current step (for pilots who already know it). */
  skip(): void {
    if (this.index < this.steps.length) this.advance();
  }

  update(s: AircraftSnapshot): TutorialView {
    const dt = this.lastTime < 0 ? 0 : Math.max(0, Math.min(0.25, s.time - this.lastTime));
    this.lastTime = s.time;
    const step = this.steps[this.index];
    if (step && step.kind !== 'read' && !s.crashed) {
      if (step.test({ s, seen: this.seen, flags: this.flags, waypoint: this.waypoint })) {
        this.held += dt;
        if (this.held >= step.hold) this.advance();
      } else {
        this.held = 0;
      }
    }
    const cur = this.steps[this.index];
    const reading = cur?.kind === 'read';
    const expectsTerrain = cur?.id === 'terrain';
    let caution: string | null = null;
    if (cur && !reading && !expectsTerrain && !s.crashed && (s.warnMask & 1) !== 0) caution = '注意：PULL UP！先拉起來，再繼續練習。';
    else if (cur && !reading && !expectsTerrain && s.altitude < 600) caution = '高度偏低，先拉高再繼續。';
    return {
      index: this.index,
      total: this.steps.length,
      title: cur?.title ?? '完成',
      hint: cur?.hint ?? '本章完成！你可以繼續自由飛行，或按 R 重新開始。',
      touchHint: cur?.touchHint ?? cur?.hint ?? '本章完成！你可以繼續自由飛行，或按 R 重新開始。',
      body: cur?.body ?? [],
      kind: reading ? 'read' : 'action',
      done: !cur,
      progress: cur ? (reading ? 0 : cur.hold > 0 ? Math.min(1, this.held / cur.hold) : 0) : 1,
      wantsAutopilot: reading,
      caution,
    };
  }
}
