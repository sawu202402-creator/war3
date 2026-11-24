import { TargetPriority } from '../types';

export interface StickState {
  active: boolean;
  id: number;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  dx: number;
  dy: number;
}

export interface AimingSkillState {
  slot: number; // 0..3 hero skills, 4 = flash, 5 = active item
  pointerId: number;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  dx: number;
  dy: number;
  distRatio: number; // 0..1
  cancelled: boolean;
}

export class InputManager {
  public keys = new Set<string>();
  public mouseScreenX = 0;
  public mouseScreenY = 0;
  public mouseDown = false;
  public usingTouch = false;
  public attackHeld = false;
  public targetPriority: TargetPriority = 'nearest';
  public rightClickMoveEnabled = false;
  public moveTargetWorld: { x: number; y: number } | null = null;

  public moveStick: StickState = {
    active: false,
    id: -1,
    startX: 0,
    startY: 0,
    curX: 0,
    curY: 0,
    dx: 0,
    dy: 0,
  };
  public aimingSkill: AimingSkillState | null = null;

  private lastTouchAt = 0;
  private onCastSkillCb: ((slot: number, dirX?: number, dirY?: number, distRatio?: number) => void) | null = null;
  private onUsePotionCb: ((slot: 'hp' | 'mp' | 'tactical') => void) | null = null;
  private onFlashCb: ((dirX?: number, dirY?: number) => void) | null = null;
  private onRecallCb: (() => void) | null = null;
  private onTeleportCb: (() => void) | null = null;
  private onToggleShopCb: (() => void) | null = null;
  private onToggleBaseCb: (() => void) | null = null;
  private onPingCb: (() => void) | null = null;
  private onPauseCb: (() => void) | null = null;
  private onActiveItemCb: (() => void) | null = null;
  private onRightClickWorldCb: ((screenX: number, screenY: number) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    if (this.detectTouchDevice()) {
      this.usingTouch = true;
    }

    const markTouch = () => {
      this.lastTouchAt = performance.now();
      this.usingTouch = true;
    };

    window.addEventListener('touchstart', markTouch, { passive: true });
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') markTouch();
      },
      { passive: true }
    );

    const isSyntheticTouch = (e?: MouseEvent): boolean => {
      if (performance.now() - this.lastTouchAt < 1800) return true;
      const sc = (e as (MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }) | undefined)
        ?.sourceCapabilities;
      return Boolean(sc?.firesTouchEvents);
    };

    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }

      const code = e.code;
      if (code.startsWith('Arrow') || code === 'Space' || code === 'Tab') {
        e.preventDefault();
      }
      if (e.repeat) return;

      const gameMoveKey =
        code === 'KeyW' ||
        code === 'KeyA' ||
        code === 'KeyS' ||
        code === 'KeyD' ||
        code.startsWith('Arrow') ||
        code === 'Space';
      if (gameMoveKey) {
        this.keys.add(code);
        this.moveTargetWorld = null;
        if (!this.detectTouchDevice() && performance.now() - this.lastTouchAt > 1800) {
          this.usingTouch = false;
        }
      }

      if (code === 'KeyQ') this.onCastSkillCb?.(0);
      else if (code === 'KeyE') this.onCastSkillCb?.(1);
      else if (code === 'KeyR') this.onCastSkillCb?.(2);
      else if (code === 'KeyF') this.onCastSkillCb?.(3);
      else if (code === 'Digit1') this.onUsePotionCb?.('hp');
      else if (code === 'Digit2') this.onUsePotionCb?.('mp');
      else if (code === 'Digit3') this.onUsePotionCb?.('tactical');
      else if (code === 'KeyD' && e.shiftKey) this.onFlashCb?.();
      else if (code === 'KeyC') this.onFlashCb?.();
      else if (code === 'KeyG') this.onToggleBaseCb?.();
      else if (code === 'KeyB') this.onRecallCb?.();
      else if (code === 'KeyT') this.onTeleportCb?.();
      else if (code === 'Tab') this.onToggleShopCb?.();
      else if (code === 'KeyV') this.onPingCb?.();
      else if (code === 'KeyZ') this.onActiveItemCb?.();
      else if (code === 'Escape' || code === 'KeyP') this.onPauseCb?.();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => this.resetStates());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetStates();
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (isSyntheticTouch(e)) return;
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreenX = e.clientX - rect.left;
      this.mouseScreenY = e.clientY - rect.top;
      this.usingTouch = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (isSyntheticTouch(e)) return;
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreenX = e.clientX - rect.left;
      this.mouseScreenY = e.clientY - rect.top;
      this.usingTouch = false;
      if (e.button === 0) {
        this.mouseDown = true;
      } else if (e.button === 2) {
        if (this.aimingSkill) {
          this.aimingSkill = null;
        } else if (this.rightClickMoveEnabled) {
          this.onRightClickWorldCb?.(this.mouseScreenX, this.mouseScreenY);
        } else {
          this.onCastSkillCb?.(0);
        }
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });

    // Left-half dynamic-center virtual stick on canvas touch
    this.canvas.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        markTouch();
        const rect = this.canvas.getBoundingClientRect();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const x = t.clientX - rect.left;
          const y = t.clientY - rect.top;
          if (x < rect.width * 0.48 && !this.moveStick.active) {
            this.moveStick = {
              active: true,
              id: t.identifier,
              startX: x,
              startY: y,
              curX: x,
              curY: y,
              dx: 0,
              dy: 0,
            };
          }
        }
      },
      { passive: false }
    );

    this.canvas.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const maxR = Math.min(rect.width, rect.height) < 420 ? 44 : 54;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (this.moveStick.active && t.identifier === this.moveStick.id) {
            const x = t.clientX - rect.left;
            const y = t.clientY - rect.top;
            let vx = x - this.moveStick.startX;
            let vy = y - this.moveStick.startY;
            let dist = Math.hypot(vx, vy) || 1;
            if (dist > maxR + 18) {
              const pull = dist - (maxR + 18);
              this.moveStick.startX += (vx / dist) * pull;
              this.moveStick.startY += (vy / dist) * pull;
              vx = x - this.moveStick.startX;
              vy = y - this.moveStick.startY;
              dist = Math.hypot(vx, vy) || 1;
            }
            const clamped = Math.min(dist, maxR);
            this.moveStick.curX = this.moveStick.startX + (vx / dist) * clamped;
            this.moveStick.curY = this.moveStick.startY + (vy / dist) * clamped;
            this.moveStick.dx = dist > 5 ? (vx / dist) * (clamped / maxR) : 0;
            this.moveStick.dy = dist > 5 ? (vy / dist) * (clamped / maxR) : 0;
            this.moveTargetWorld = null;
          }
        }
      },
      { passive: false }
    );

    const endTouch = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.moveStick.active && t.identifier === this.moveStick.id) {
          this.moveStick.active = false;
          this.moveStick.dx = 0;
          this.moveStick.dy = 0;
        }
      }
    };
    this.canvas.addEventListener('touchend', endTouch);
    this.canvas.addEventListener('touchcancel', endTouch);
  }

  private detectTouchDevice(): boolean {
    if (typeof window === 'undefined') return false;
    return (
      navigator.maxTouchPoints > 0 &&
      window.matchMedia('(pointer: coarse)').matches
    );
  }

  public bindActions(handlers: {
    onCastSkill: (slot: number, dirX?: number, dirY?: number, distRatio?: number) => void;
    onUsePotion: (slot: 'hp' | 'mp' | 'tactical') => void;
    onFlash: (dirX?: number, dirY?: number) => void;
    onRecall: () => void;
    onTeleport: () => void;
    onToggleShop: () => void;
    onToggleBase: () => void;
    onPing: () => void;
    onPause: () => void;
    onActiveItem: () => void;
    onRightClickWorld: (screenX: number, screenY: number) => void;
  }): void {
    this.onCastSkillCb = handlers.onCastSkill;
    this.onUsePotionCb = handlers.onUsePotion;
    this.onFlashCb = handlers.onFlash;
    this.onRecallCb = handlers.onRecall;
    this.onTeleportCb = handlers.onTeleport;
    this.onToggleShopCb = handlers.onToggleShop;
    this.onToggleBaseCb = handlers.onToggleBase;
    this.onPingCb = handlers.onPing;
    this.onPauseCb = handlers.onPause;
    this.onActiveItemCb = handlers.onActiveItem;
    this.onRightClickWorldCb = handlers.onRightClickWorld;
  }

  public getMoveVector(): { x: number; y: number } {
    if (this.moveStick.active && (this.moveStick.dx !== 0 || this.moveStick.dy !== 0)) {
      return { x: this.moveStick.dx, y: this.moveStick.dy };
    }
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  public isAttackPressed(): boolean {
    return this.mouseDown || this.attackHeld || this.keys.has('Space');
  }

  public cycleTargetPriority(): TargetPriority {
    if (this.targetPriority === 'nearest') this.targetPriority = 'boss';
    else if (this.targetPriority === 'boss') this.targetPriority = 'low_hp';
    else this.targetPriority = 'nearest';
    return this.targetPriority;
  }

  public resetStates(): void {
    this.keys.clear();
    this.mouseDown = false;
    this.attackHeld = false;
    this.moveStick.active = false;
    this.moveStick.dx = 0;
    this.moveStick.dy = 0;
    this.aimingSkill = null;
  }
}
