import { TALENT_TRACKS, getHeroClassDef } from '../data/heroes';
import { DailyMissionDef, HeroClassId, SaveData, TalentLevels } from '../types';

const SAVE_KEY = 'war3_athena_save_v1';

export const DAILY_CHECKIN_REWARDS = [
  { day: 1, honor: 90 },
  { day: 2, honor: 130 },
  { day: 3, honor: 180 },
  { day: 4, honor: 240 },
  { day: 5, honor: 310 },
  { day: 6, honor: 400 },
  { day: 7, honor: 620 },
];

export const DAILY_MISSIONS: DailyMissionDef[] = [
  { id: 'dm_kills', kind: 'kills', target: 150, rewardHonor: 110, title: '战场屠戮：今日累计击杀 150 名敌人' },
  { id: 'dm_waves', kind: 'waves', target: 12, rewardHonor: 120, title: '坚守圣殿：今日累计抵御 12 波进攻' },
  { id: 'dm_bosses', kind: 'bosses', target: 3, rewardHonor: 150, title: '斩魔猎手：今日击杀 3 名秘境/阶段 Boss' },
  { id: 'dm_synth', kind: 'syntheses', target: 2, rewardHonor: 140, title: '神匠铸造：今日累计合成 2 件高阶神装' },
  { id: 'dm_quests', kind: 'quests', target: 1, rewardHonor: 130, title: '勇者试炼：今日完成 1 次运水/剿匪/试炼支线' },
];

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getYesterdayKey(): string {
  const d = new Date(Date.now() - 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function createDefaultSave(): SaveData {
  return {
    callsign: `圣殿勇者-${Math.floor(10 + Math.random() * 89)}`,
    honorCoins: 240,
    selectedHero: 'blademaster',
    unlockedHeroes: ['paladin', 'blademaster', 'archmage'],
    maxClearedDifficulty: 0,
    bestEndlessWave: {},
    heroMasteryXp: {
      paladin: 0,
      blademaster: 0,
      archmage: 0,
      ranger: 0,
      priest: 0,
    },
    talents: {
      startGold: 0,
      xpBoost: 0,
      might: 0,
      vitality: 0,
      haste: 0,
      reviveFast: 0,
    },
    discoveredItems: [],
    defeatedBosses: [],
    careerKills: 0,
    totalClears: 0,
    rightClickMove: false,
    hudMode: 'auto',
    aiSquadCount: 1,
    daily: {
      dateKey: getTodayKey(),
      lastSignDate: '',
      signStreak: 0,
      missionProgress: {},
      claimedIds: [],
    },
  };
}

class SaveDataManager {
  private data: SaveData = createDefaultSave();

  public load(): SaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        const def = createDefaultSave();
        this.data = {
          ...def,
          ...parsed,
          talents: { ...def.talents, ...(parsed.talents || {}) },
          heroMasteryXp: { ...def.heroMasteryXp, ...(parsed.heroMasteryXp || {}) },
          daily: { ...def.daily, ...(parsed.daily || {}) },
          unlockedHeroes: Array.isArray(parsed.unlockedHeroes) && parsed.unlockedHeroes.length > 0
            ? (Array.from(new Set(['paladin', 'blademaster', 'archmage', ...parsed.unlockedHeroes])) as HeroClassId[])
            : def.unlockedHeroes,
          discoveredItems: Array.isArray(parsed.discoveredItems) ? parsed.discoveredItems : [],
          defeatedBosses: Array.isArray(parsed.defeatedBosses) ? parsed.defeatedBosses : [],
        };
      }
    } catch {
      this.data = createDefaultSave();
    }
    this.rolloverDaily();
    this.save();
    return this.data;
  }

  public get(): SaveData {
    return this.data;
  }

  public save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // ignore quota errors
    }
  }

  public rolloverDaily(): void {
    const today = getTodayKey();
    if (this.data.daily.dateKey !== today) {
      this.data.daily.dateKey = today;
      this.data.daily.missionProgress = {};
      this.data.daily.claimedIds = [];
      if (this.data.daily.lastSignDate && this.data.daily.lastSignDate !== getYesterdayKey() && this.data.daily.lastSignDate !== today) {
        this.data.daily.signStreak = 0;
      }
    }
  }

  public setCallsign(name: string): void {
    const clean = name.trim().slice(0, 12);
    if (clean) {
      this.data.callsign = clean;
      this.save();
    }
  }

  public selectHero(id: HeroClassId): void {
    if (this.data.unlockedHeroes.includes(id)) {
      this.data.selectedHero = id;
      this.save();
    }
  }

  public unlockHero(id: HeroClassId): boolean {
    if (this.data.unlockedHeroes.includes(id)) return true;
    const def = getHeroClassDef(id);
    if (this.data.honorCoins < def.unlockCost) return false;
    this.data.honorCoins -= def.unlockCost;
    this.data.unlockedHeroes.push(id);
    this.data.selectedHero = id;
    this.save();
    return true;
  }

  public getTalentUpgradeCost(key: keyof TalentLevels): number {
    const track = TALENT_TRACKS.find((t) => t.key === key);
    if (!track) return 999999;
    const lv = this.data.talents[key] || 0;
    return track.baseCost + lv * track.costStep;
  }

  public upgradeTalent(key: keyof TalentLevels): boolean {
    const track = TALENT_TRACKS.find((t) => t.key === key);
    if (!track) return false;
    const lv = this.data.talents[key] || 0;
    if (lv >= track.maxLevel) return false;
    const cost = this.getTalentUpgradeCost(key);
    if (this.data.honorCoins < cost) return false;
    this.data.honorCoins -= cost;
    this.data.talents[key] = lv + 1;
    this.save();
    return true;
  }

  public getHeroMasteryLevel(hero: HeroClassId): { level: number; curXp: number; nextXp: number } {
    const xp = this.data.heroMasteryXp[hero] || 0;
    const level = Math.min(20, 1 + Math.floor(Math.sqrt(xp / 120)));
    const curFloor = Math.pow(level - 1, 2) * 120;
    const nextFloor = Math.pow(level, 2) * 120;
    return { level, curXp: xp - curFloor, nextXp: Math.max(120, nextFloor - curFloor) };
  }

  public canCheckInToday(): boolean {
    this.rolloverDaily();
    return this.data.daily.lastSignDate !== getTodayKey();
  }

  public claimCheckIn(): number {
    if (!this.canCheckInToday()) return 0;
    const today = getTodayKey();
    const yesterday = getYesterdayKey();
    const streak = this.data.daily.lastSignDate === yesterday ? (this.data.daily.signStreak % 7) + 1 : 1;
    this.data.daily.signStreak = streak;
    this.data.daily.lastSignDate = today;
    const reward = DAILY_CHECKIN_REWARDS[streak - 1]?.honor || 100;
    this.data.honorCoins += reward;
    this.save();
    return reward;
  }

  public addDailyProgress(kind: DailyMissionDef['kind'], delta = 1): void {
    this.rolloverDaily();
    for (const m of DAILY_MISSIONS) {
      if (m.kind === kind) {
        this.data.daily.missionProgress[m.id] = (this.data.daily.missionProgress[m.id] || 0) + delta;
      }
    }
    this.save();
  }

  public claimDailyMission(id: string): number {
    this.rolloverDaily();
    if (this.data.daily.claimedIds.includes(id)) return 0;
    const m = DAILY_MISSIONS.find((x) => x.id === id);
    if (!m) return 0;
    const cur = this.data.daily.missionProgress[id] || 0;
    if (cur < m.target) return 0;
    this.data.daily.claimedIds.push(id);
    this.data.honorCoins += m.rewardHonor;
    this.save();
    return m.rewardHonor;
  }

  public recordRunResult(opts: {
    hero: HeroClassId;
    difficulty: number;
    maxWave: number;
    victory: boolean;
    kills: number;
    honorEarned: number;
    discoveredItems: string[];
    defeatedBosses: string[];
  }): void {
    this.data.careerKills += opts.kills;
    this.data.honorCoins += opts.honorEarned;
    this.data.heroMasteryXp[opts.hero] = (this.data.heroMasteryXp[opts.hero] || 0) + Math.max(40, Math.round(opts.maxWave * 18 + opts.kills * 0.4));
    if (opts.victory) {
      this.data.totalClears += 1;
      if (opts.difficulty > this.data.maxClearedDifficulty) {
        this.data.maxClearedDifficulty = opts.difficulty;
      }
    }
    const key = `${opts.hero}_${opts.difficulty}`;
    if (opts.maxWave > (this.data.bestEndlessWave[key] || 0)) {
      this.data.bestEndlessWave[key] = opts.maxWave;
    }
    for (const it of opts.discoveredItems) {
      if (!this.data.discoveredItems.includes(it)) this.data.discoveredItems.push(it);
    }
    for (const b of opts.defeatedBosses) {
      if (!this.data.defeatedBosses.includes(b)) this.data.defeatedBosses.push(b);
    }
    this.save();
  }
}

export const SaveManager = new SaveDataManager();
