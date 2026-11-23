import type { AircraftSnapshot } from '../physics/stateLayout';
import { attitudeFromQuat } from '../cockpit/camera';
import { radToDeg } from '../core/math';

/** AOA caution bit in the warning mask (see physics/warnings.ts). */
const WARN_AOA_BIT = 7;

export interface TutorialStep {
  id: string;
  title: string;
  hint: string;
  /** True while the condition holds; the step completes after it has held for `hold` seconds. */
  test: (s: AircraftSnapshot) => boolean;
  hold: number;
}

const attitude = (s: AircraftSnapshot) => {
  const a = attitudeFromQuat(s.orientation);
  return { pitch: radToDeg(a.pitch), roll: radToDeg(a.roll) };
};

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'pitch',
    title: '俯仰',
    hint: '按 ↓ 拉桿（觸控：搖桿往下拉），讓機頭抬高到地平線上方約 10°（俯仰梯上的 10）。',
    test: (s) => attitude(s).pitch > 10,
    hold: 0.3,
  },
  {
    id: 'level',
    title: '改平',
    hint: '按 ↑ 推回（觸控：搖桿往上），讓機頭回到地平線附近（±4°），機翼保持水平。',
    test: (s) => {
      const a = attitude(s);
      return Math.abs(a.pitch) < 4 && Math.abs(a.roll) < 6;
    },
    hold: 1.5,
  },
  {
    id: 'roll',
    title: '滾轉',
    hint: '按 →（觸控：搖桿往右）向右滾轉，直到飛機傾斜 45° 以上。',
    test: (s) => Math.abs(attitude(s).roll) > 45,
    hold: 0.3,
  },
  {
    id: 'unroll',
    title: '改正傾斜',
    hint: '按 ←（觸控：搖桿往左）把機翼改回水平（傾斜小於 6°）。',
    test: (s) => Math.abs(attitude(s).roll) < 6,
    hold: 1.0,
  },
  {
    id: 'throttle',
    title: '油門',
    hint: '按住 W（觸控：右側滑桿往上）把油門推到 80% 以上，觀察 THR 與速度。',
    test: (s) => s.throttle >= 0.8,
    hold: 0.5,
  },
  {
    id: 'afterburner',
    title: '後燃器',
    hint: '把油門推到底（100%）點燃後燃器，HUD 會出現 AB。注意燃油消耗速度。',
    test: (s) => s.afterburner,
    hold: 1.0,
  },
  {
    id: 'idle',
    title: '收油門',
    hint: '按住 S（觸控：滑桿往下）把油門收到 40% 以下。',
    test: (s) => s.throttle <= 0.4,
    hold: 0.5,
  },
  {
    id: 'aoa',
    title: '認識迎角警告',
    hint: '高度夠的時候（> 1000 m）持續拉桿，直到出現黃色 AOA 警告；飛控會擋在失速角之前。然後鬆桿。',
    test: (s) => s.altitude > 1000 && (s.warnMask & (1 << WARN_AOA_BIT)) !== 0,
    hold: 0.3,
  },
  {
    id: 'terrain',
    title: '地形警告',
    hint: '保持俯衝（↑）直到出現紅色 PULL UP，然後立刻拉桿（↓）改出。畫面上的 IMPACT 是直線預測撞擊時間。',
    test: (s) => (s.warnMask & 1) !== 0,
    hold: 0.2,
  },
  {
    id: 'recover',
    title: '改出',
    hint: '拉起後讓警告消失，並回到 1000 m 以上。',
    test: (s) => s.altitude > 1000 && s.warnMask === 0,
    hold: 1.0,
  },
];

export interface TutorialView {
  index: number; // 0-based current step, == total when finished
  total: number;
  title: string;
  hint: string;
  done: boolean;
  /** 0..1 progress of the dwell timer of the current step. */
  progress: number;
  /** Extra line when the pilot is in danger in a step that does not expect it. */
  caution: string | null;
}

/** Guided checklist driven only by the physics snapshots (no extra physics state). */
export class Tutorial {
  private index = 0;
  private held = 0;
  private lastTime = -1;

  constructor(private readonly steps: readonly TutorialStep[] = TUTORIAL_STEPS) {}

  reset(): void {
    this.index = 0;
    this.held = 0;
    this.lastTime = -1;
  }

  /** Skip the current step (for pilots who already know it). */
  skip(): void {
    if (this.index < this.steps.length) {
      this.index++;
      this.held = 0;
    }
  }

  update(s: AircraftSnapshot): TutorialView {
    const dt = this.lastTime < 0 ? 0 : Math.max(0, Math.min(0.25, s.time - this.lastTime));
    this.lastTime = s.time;
    const step = this.steps[this.index];
    if (step && !s.crashed) {
      if (step.test(s)) {
        this.held += dt;
        if (this.held >= step.hold) {
          this.index++;
          this.held = 0;
        }
      } else {
        this.held = 0;
      }
    }
    const cur = this.steps[this.index];
    const expectsTerrain = cur?.id === 'terrain';
    let caution: string | null = null;
    if (cur && !expectsTerrain && !s.crashed && (s.warnMask & 1) !== 0) caution = '注意：PULL UP！先拉起來，再繼續練習。';
    else if (cur && !expectsTerrain && s.altitude < 600) caution = '高度偏低，先拉高再繼續。';
    return {
      index: this.index,
      total: this.steps.length,
      title: cur?.title ?? '完成',
      hint: cur?.hint ?? '教學完成！你可以自由飛行，或按 R 重新開始。',
      done: !cur,
      progress: cur ? Math.min(1, this.held / cur.hold) : 1,
      caution,
    };
  }
}
