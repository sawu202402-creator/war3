import { SaveManager } from '../meta/SaveManager';
import { DifficultyLevel, HeroClassId } from '../types';
import { CoopNetMessage, LobbyMember, LobbyState, PublicRoomAd, RoomChatEntry, SQUAD_COLORS } from './CoopProtocol';
import { MqttWsRoomBus, RoomWireEnvelope } from './MqttWsRoomBus';

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PUBLIC_HALL_ROOM_ID = '__PUBLIC_HALL__';

type DirBusPayload =
  | { type: 'dir_query' }
  | { type: 'dir_announce'; ad: PublicRoomAd }
  | { type: 'dir_close'; roomCode: string };

type BusPayload =
  | CoopNetMessage
  | { type: '__hb' }
  | { type: '__bye' }
  | { type: '__ping'; t0: number }
  | { type: '__pong'; t0: number }
  | { type: '__rtc'; sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit };

interface PeerRtcBundle {
  pc: RTCPeerConnection;
  dcFast: RTCDataChannel | null;
  dcCombat: RTCDataChannel | null;
  dcRel: RTCDataChannel | null;
  pendingCands: RTCIceCandidateInit[];
  remoteDescSet: boolean;
}

const RTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

function isSnapshotFastMsg(msg: CoopNetMessage): boolean {
  const t = msg.type;
  return t === 'world_snap' || t === 'heroes_fast' || t === 'client_pos';
}

function isCombatUnorderedMsg(msg: CoopNetMessage): boolean {
  const t = msg.type;
  return t === 'cmd_attack' || t === 'cmd_skill' || t === 'cmd_flash' || t === 'evt_fx';
}

function randomCode(len = 5): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return out;
}

class CoopNetworkManager {
  public role: 'offline' | 'host' | 'client' = 'offline';
  public status: 'idle' | 'connecting' | 'ready' | 'error' = 'idle';
  public errorMsg = '';
  public myPeerId = 'local';
  public mySlot = 0;
  public lobby: LobbyState | null = null;
  public lastJoinCode = '';
  public rttMs = 0;
  public roomChatLog: RoomChatEntry[] = [];

  private normalizeRoomTitle(raw?: string, hostName = '冒险者'): string {
    const clean = (raw || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 20);
    if (clean) return clean;
    const h = (hostName || '冒险者').trim().slice(0, 10) || '冒险者';
    return `${h}的战局`;
  }
  public currentMatchSeq = 0;

  private bus: MqttWsRoomBus<BusPayload> | null = null;
  private rtcPeers = new Map<string, PeerRtcBundle>();
  private hostPeerId = '';
  private clientLastSeen = new Map<string, number>();
  private hostLastSeen = 0;
  private heartbeatTimer = 0;
  private joinRetryTimer = 0;
  private lastJoinReqSentAt = 0;
  private inMatchTriggered = false;
  private hostMatchSeq = 0;
  private lastClientMatchSeq = 0;
  private hostCurrentWave = 1;
  private pendingClientHeroSync: { heroClass: HeroClassId; until: number } | null = null;

  // Frame-burst snapshot coalescing buffers (prevents multi-parse stutters on mobile Wi-Fi)
  private pendingClientWorldRaw: string | null = null;
  private pendingClientHeroesRaw: string | null = null;
  private pendingHostClientPosRaw = new Map<string, string>();

  // Public Room Hall discovery
  private dirBus: MqttWsRoomBus<DirBusPayload> | null = null;
  private dirPeerId = `wdir_${randomCode(6).toLowerCase()}`;
  private dirAnnounceTimer = 0;
  private publicRoomMap = new Map<string, PublicRoomAd>();

  private onLobbyChangeCb: (() => void) | null = null;
  private onMatchStartCb: ((lobby: LobbyState) => void) | null = null;
  private onPublicRoomsChangeCb: (() => void) | null = null;
  private onGameMessageCb: ((msg: CoopNetMessage, fromPeerId: string) => void) | null = null;
  private onPeerLeaveCb: ((peerId: string) => void) | null = null;
  private onPeerHotJoinCb: ((member: LobbyMember) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        if (this.bus && this.role !== 'offline') this.bus.send('*', { type: '__bye' });
      });
      const wake = () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (!this.bus || this.role === 'offline') return;
        const now = performance.now();
        this.hostLastSeen = now;
        for (const k of this.clientLastSeen.keys()) this.clientLastSeen.set(k, now);
        this.bus.wakeAndCheckLinks();
        if (this.role === 'host' && this.lobby) {
          this.bus.send('*', { type: '__hb' });
          if (!this.lobby.inGame) this.broadcastLobby();
        } else if (this.role === 'client') {
          const missingSelf = !this.lobby || !this.lobby.members.some((m) => m.peerId === this.myPeerId);
          if (this.status === 'connecting' || (this.status === 'ready' && missingSelf && !this.lobby?.inGame)) {
            this.sendJoinReqThrottled(true);
          } else if (this.status === 'ready') {
            this.bus.send(this.hostPeerId, { type: '__hb' });
          }
        }
      };
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
      window.addEventListener('focus', wake);
    }
  }

  private sendJoinReqThrottled(force = false): void {
    if (this.role !== 'client' || !this.bus || !this.hostPeerId) return;
    const now = performance.now();
    if (!force && now - this.lastJoinReqSentAt < 420) return;
    this.lastJoinReqSentAt = now;
    const save = SaveManager.get();
    this.bus.send(this.hostPeerId, {
      type: 'join_req',
      callsign: save.callsign,
      heroClass: save.selectedHero,
    });
  }

  public bindUI(
    onLobbyChange: () => void,
    onMatchStart: (lobby: LobbyState) => void,
    onPublicRoomsChange?: () => void
  ): void {
    this.onLobbyChangeCb = onLobbyChange;
    this.onMatchStartCb = onMatchStart;
    this.onPublicRoomsChangeCb = onPublicRoomsChange || null;
  }

  public bindEngine(
    onGameMessage: (msg: CoopNetMessage, fromPeerId: string) => void,
    onPeerLeave: (peerId: string) => void,
    onPeerHotJoin?: (member: LobbyMember) => void
  ): void {
    this.onGameMessageCb = onGameMessage;
    this.onPeerLeaveCb = onPeerLeave;
    this.onPeerHotJoinCb = onPeerHotJoin || null;
  }

  public isActiveCoop(): boolean {
    return (this.role === 'host' || this.role === 'client') && this.lobby !== null;
  }

  public hasDirectP2P(): boolean {
    if (this.role === 'client') {
      const b = this.rtcPeers.get(this.hostPeerId);
      return Boolean(b?.dcFast?.readyState === 'open');
    }
    if (this.role === 'host' && this.clientLastSeen.size > 0) {
      for (const pid of this.clientLastSeen.keys()) {
        if (this.rtcPeers.get(pid)?.dcFast?.readyState !== 'open') return false;
      }
      return true;
    }
    return false;
  }

  public isCongested(): boolean {
    if (this.hasDirectP2P()) {
      for (const b of this.rtcPeers.values()) {
        if (b.dcFast?.readyState === 'open' && b.dcFast.bufferedAmount > 32_768) return true;
      }
      return false;
    }
    return this.bus ? this.bus.isCongested() : false;
  }

  public getNetStatusLabel(): string {
    const mode = this.hasDirectP2P() ? 'P2P直连' : '云中继';
    return this.rttMs > 0 ? `${mode} · ${this.rttMs}ms` : mode;
  }

  public getInviteUrl(): string {
    if (!this.lobby || typeof window === 'undefined') return '';
    const u = new URL(window.location.href);
    u.searchParams.set('room', this.lobby.roomCode);
    return u.toString();
  }

  public consumeUrlRoomParam(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const u = new URL(window.location.href);
      const code = u.searchParams.get('room');
      if (code && code.trim().length >= 4) {
        u.searchParams.delete('room');
        window.history.replaceState({}, '', u.toString());
        const clean = code.trim().toUpperCase();
        this.lastJoinCode = clean;
        return clean;
      }
    } catch {
      // ignore
    }
    return null;
  }

  public clearMatchSnapshots(): void {
    this.pendingClientWorldRaw = null;
    this.pendingClientHeroesRaw = null;
    this.pendingHostClientPosRaw.clear();
  }

  public flushCoalescedSnapshots(): void {
    if (this.role === 'client') {
      const wRaw = this.pendingClientWorldRaw;
      const hRaw = this.pendingClientHeroesRaw;
      this.pendingClientWorldRaw = null;
      this.pendingClientHeroesRaw = null;
      if (wRaw) {
        try {
          const parsed = JSON.parse(wRaw) as { m?: CoopNetMessage };
          if (parsed?.m) this.onGameMessageCb?.(parsed.m, this.hostPeerId);
        } catch {
          // ignore
        }
      }
      if (hRaw) {
        try {
          const parsed = JSON.parse(hRaw) as { m?: CoopNetMessage };
          if (parsed?.m) this.onGameMessageCb?.(parsed.m, this.hostPeerId);
        } catch {
          // ignore
        }
      }
    } else if (this.role === 'host' && this.pendingHostClientPosRaw.size > 0) {
      for (const [peerId, raw] of this.pendingHostClientPosRaw.entries()) {
        if (!this.clientLastSeen.has(peerId)) continue;
        try {
          const parsed = JSON.parse(raw) as { m?: CoopNetMessage };
          if (parsed?.m) this.onGameMessageCb?.(parsed.m, peerId);
        } catch {
          // ignore
        }
      }
      this.pendingHostClientPosRaw.clear();
    }
  }

  // ==================== Public Room Hall Discovery ====================

  public ensurePublicDirectoryActive(): void {
    if (this.dirBus) {
      this.dirBus.wakeAndCheckLinks();
      return;
    }
    this.dirBus = new MqttWsRoomBus<DirBusPayload>(
      this.dirPeerId,
      PUBLIC_HALL_ROOM_ID,
      () => {
        this.dirBus?.send('*', { type: 'dir_query' });
        if (this.role === 'host' && this.lobby) this.publishHostDirectoryState();
      },
      (env) => {
        const msg = env.msg;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'dir_query') {
          if (this.role === 'host' && this.lobby && this.lobby.isPublic !== false && this.lobby.members.length < 4) {
            this.publishHostDirectoryState();
          }
          return;
        }
        if (msg.type === 'dir_announce' && msg.ad?.roomCode) {
          if (this.lobby?.roomCode === msg.ad.roomCode) return;
          if (msg.ad.memberCount >= msg.ad.maxMembers) {
            this.publicRoomMap.delete(msg.ad.roomCode);
          } else {
            this.publicRoomMap.set(msg.ad.roomCode, { ...msg.ad, updatedAt: Date.now() });
          }
          this.onPublicRoomsChangeCb?.();
          return;
        }
        if (msg.type === 'dir_close' && msg.roomCode) {
          if (this.publicRoomMap.delete(msg.roomCode)) this.onPublicRoomsChangeCb?.();
        }
      },
      () => {
        // silent fallback if public hall unreachable
      }
    );

    window.clearInterval(this.dirAnnounceTimer);
    this.dirAnnounceTimer = window.setInterval(() => {
      const now = Date.now();
      let pruned = false;
      for (const [rc, ad] of Array.from(this.publicRoomMap.entries())) {
        if (now - ad.updatedAt > 12_500) {
          this.publicRoomMap.delete(rc);
          pruned = true;
        }
      }
      if (pruned) this.onPublicRoomsChangeCb?.();
      if (this.role === 'host' && this.lobby && this.lobby.isPublic !== false && this.lobby.members.length < 4) {
        this.publishHostDirectoryState();
      }
    }, 3200);
  }

  public getPublicRooms(): PublicRoomAd[] {
    const now = Date.now();
    const list: PublicRoomAd[] = [];
    for (const [rc, ad] of this.publicRoomMap.entries()) {
      if (now - ad.updatedAt > 12_500) {
        this.publicRoomMap.delete(rc);
        continue;
      }
      if (this.lobby?.roomCode === rc) continue;
      if (ad.memberCount < ad.maxMembers) list.push(ad);
    }
    list.sort((a, b) => {
      if (a.inGame !== b.inGame) return a.inGame ? 1 : -1;
      return b.memberCount - a.memberCount;
    });
    return list;
  }

  public publishHostDirectoryState(): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.ensurePublicDirectoryActive();
    if (this.lobby.isPublic === false || this.lobby.members.length >= 4) {
      this.dirBus?.send('*', { type: 'dir_close', roomCode: this.lobby.roomCode });
      return;
    }
    const hostMem = this.lobby.members.find((m) => m.isHost) || this.lobby.members[0];
    const hostName = hostMem?.callsign || SaveManager.get().callsign;
    const memberHeroes = this.lobby.members.slice(0, 4).map((m) => m.heroClass);
    this.dirBus?.send('*', {
      type: 'dir_announce',
      ad: {
        roomCode: this.lobby.roomCode,
        roomTitle: this.lobby.roomTitle || this.normalizeRoomTitle(undefined, hostName),
        hostName,
        hostHero: hostMem?.heroClass || SaveManager.get().selectedHero,
        memberHeroes,
        difficulty: this.lobby.difficulty,
        memberCount: this.lobby.members.length,
        maxMembers: 4,
        inGame: this.lobby.inGame,
        wave: this.lobby.inGame ? Math.max(1, this.hostCurrentWave) : 1,
        updatedAt: Date.now(),
      },
    });
  }

  public setHostWaveForDirectory(wave: number): void {
    if (this.hostCurrentWave === wave) return;
    this.hostCurrentWave = wave;
    if (this.role === 'host' && this.lobby?.inGame) {
      this.publishHostDirectoryState();
    }
  }

  public toggleHostPublicRoom(): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.lobby.isPublic = this.lobby.isPublic === false;
    this.broadcastLobby();
    this.publishHostDirectoryState();
    this.notifyLobby();
  }

  public quickMatchOrCreate(difficulty: DifficultyLevel = 1): void {
    this.ensurePublicDirectoryActive();
    const openRooms = this.getPublicRooms();
    const waitingRoom = openRooms.find((r) => !r.inGame) || openRooms[0];
    if (waitingRoom) {
      this.joinRoomByCode(waitingRoom.roomCode);
      return;
    }
    this.createHostRoom(difficulty, true);
  }

  public disconnect(): void {
    if (this.role === 'host' && this.lobby) {
      this.dirBus?.send('*', { type: 'dir_close', roomCode: this.lobby.roomCode });
    }
    this.roomChatLog = [];
    this.pendingClientHeroSync = null;
    window.clearInterval(this.heartbeatTimer);
    window.clearInterval(this.joinRetryTimer);
    for (const pid of Array.from(this.rtcPeers.keys())) this.closeRtcPeer(pid);
    if (this.bus) {
      if (this.role !== 'offline') this.bus.send('*', { type: '__bye' });
      this.bus.close();
      this.bus = null;
    }
    this.clientLastSeen.clear();
    this.hostPeerId = '';
    this.hostLastSeen = 0;
    this.rttMs = 0;
    this.inMatchTriggered = false;
    this.currentMatchSeq = 0;
    this.lastClientMatchSeq = 0;
    this.hostCurrentWave = 1;
    this.clearMatchSnapshots();
    this.role = 'offline';
    this.status = 'idle';
    this.errorMsg = '';
    this.lobby = null;
    this.myPeerId = 'local';
    this.mySlot = 0;
    this.notifyLobby();
  }

  public createHostRoom(difficulty: DifficultyLevel = 1, isPublic = true, roomTitle?: string): void {
    this.disconnect();
    this.ensurePublicDirectoryActive();
    this.role = 'host';
    this.status = 'connecting';
    const code = randomCode(5);
    const hostId = `host_${code}`;
    this.myPeerId = hostId;
    this.hostPeerId = hostId;
    this.hostCurrentWave = 1;
    this.notifyLobby();

    const save = SaveManager.get();
    const resolvedTitle = this.normalizeRoomTitle(roomTitle, save.callsign);
    this.bus = new MqttWsRoomBus<BusPayload>(
      hostId,
      code,
      () => {
        if (this.role !== 'host') return;
        this.mySlot = 0;
        this.status = 'ready';
        this.lobby = {
          roomCode: code,
          roomTitle: resolvedTitle,
          difficulty,
          isPublic,
          matchSeq: this.hostMatchSeq,
          inGame: false,
          members: [
            {
              peerId: hostId,
              slot: 0,
              callsign: save.callsign,
              heroClass: save.selectedHero,
              color: SQUAD_COLORS[0],
              ready: true,
              isHost: true,
            },
          ],
        };
        this.startHeartbeatLoop();
        this.publishHostDirectoryState();
        this.notifyLobby();
      },
      (env) => this.handleHostEnvelope(env),
      () => {
        if (this.role !== 'host') return;
        this.status = 'error';
        this.errorMsg = '房间信号建立失败，请重试';
        this.notifyLobby();
      },
      () => {
        if (this.role === 'host' && this.lobby) this.broadcastLobby();
      }
    );
  }

  public joinRoomByCode(rawCode: string): void {
    const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) {
      this.status = 'error';
      this.errorMsg = '请输入有效的 5 位房间码';
      this.notifyLobby();
      return;
    }

    this.lastJoinCode = code;
    this.disconnect();
    this.role = 'client';
    this.status = 'connecting';
    const clientId = `p_${randomCode(6).toLowerCase()}`;
    this.myPeerId = clientId;
    this.hostPeerId = `host_${code}`;
    this.notifyLobby();

    this.bus = new MqttWsRoomBus<BusPayload>(
      clientId,
      code,
      () => {
        if (this.role !== 'client') return;
        let attempts = 0;
        this.sendJoinReqThrottled(true);
        window.clearInterval(this.joinRetryTimer);
        this.joinRetryTimer = window.setInterval(() => {
          if (this.role !== 'client' || this.status !== 'connecting') {
            window.clearInterval(this.joinRetryTimer);
            return;
          }
          attempts++;
          if (attempts >= 22) {
            window.clearInterval(this.joinRetryTimer);
            this.status = 'error';
            this.errorMsg = `未找到房间 [${code}]，请确认房主在线`;
            this.notifyLobby();
            return;
          }
          this.sendJoinReqThrottled(true);
        }, 750);
      },
      (env) => this.handleClientEnvelope(env),
      () => {
        if (this.role !== 'client') return;
        window.clearInterval(this.joinRetryTimer);
        this.status = 'error';
        this.errorMsg = '连接房间中继失败';
        this.notifyLobby();
      },
      () => {
        const missingSelf = !this.lobby || !this.lobby.members.some((m) => m.peerId === this.myPeerId);
        if (this.status === 'connecting' || (this.status === 'ready' && missingSelf && !this.lobby?.inGame)) {
          this.sendJoinReqThrottled(true);
        }
      }
    );
  }

  public setHostDifficulty(diff: DifficultyLevel): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.lobby.difficulty = diff;
    this.broadcastLobby();
    this.publishHostDirectoryState();
    this.notifyLobby();
  }

  public setMyHeroClass(heroClass: HeroClassId): void {
    SaveManager.selectHero(heroClass);
    if (!this.lobby) {
      this.notifyLobby();
      return;
    }
    const me = this.lobby.members.find((m) => m.peerId === this.myPeerId);
    if (!me) return;
    me.heroClass = heroClass;
    if (this.role === 'host') {
      this.broadcastLobby();
      this.publishHostDirectoryState();
    } else {
      this.pendingClientHeroSync = { heroClass, until: performance.now() + 2800 };
      const pkt: CoopNetMessage = { type: 'member_update', ready: me.ready, callsign: me.callsign, heroClass };
      this.bus?.send(this.hostPeerId, pkt);
    }
    this.notifyLobby();
  }

  public toggleClientReady(): void {
    if (this.role !== 'client' || !this.lobby) return;
    const me = this.lobby.members.find((m) => m.peerId === this.myPeerId);
    if (!me) return;
    me.ready = !me.ready;
    this.sendToHost({ type: 'member_update', ready: me.ready, callsign: me.callsign, heroClass: me.heroClass });
    this.notifyLobby();
  }

  public launchHostMatch(): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.hostMatchSeq += 1;
    const curSeq = this.hostMatchSeq;
    this.currentMatchSeq = curSeq;
    this.hostCurrentWave = 1;
    this.lobby.inGame = true;
    this.lobby.matchSeq = curSeq;
    this.inMatchTriggered = true;
    this.clearMatchSnapshots();
    this.publishHostDirectoryState();

    const sendBurst = () => {
      if (this.role !== 'host' || !this.lobby || !this.lobby.inGame || this.currentMatchSeq !== curSeq) return;
      const pkt: CoopNetMessage = { type: 'start_game', lobby: this.lobby, matchSeq: curSeq };
      this.bus?.send('*', pkt);
      const rtcWire = JSON.stringify({ f: this.myPeerId, m: pkt });
      for (const b of this.rtcPeers.values()) {
        if (b.dcRel?.readyState === 'open') {
          try {
            b.dcRel.send(rtcWire);
          } catch {
            // ignore
          }
        }
      }
    };
    sendBurst();
    window.setTimeout(sendBurst, 350);
    window.setTimeout(sendBurst, 900);
    this.onMatchStartCb?.(this.lobby);
  }

  public returnSquadToLobby(): void {
    if (!this.lobby) return;
    this.lobby.inGame = false;
    this.inMatchTriggered = false;
    this.hostCurrentWave = 1;
    this.clearMatchSnapshots();
    if (this.role === 'host') {
      this.broadcastLobby();
      this.publishHostDirectoryState();
    }
    this.notifyLobby();
  }

  public markHostMatchEnded(): void {
    this.clearMatchSnapshots();
    if (this.role === 'host' && this.lobby) {
      this.lobby.inGame = false;
      this.publishHostDirectoryState();
    }
  }

  private acceptClientMatchStart(lobby: LobbyState, seq: number): void {
    const effSeq = seq > 0 ? seq : lobby.matchSeq || 1;
    if (this.inMatchTriggered && effSeq === this.lastClientMatchSeq) return;
    if (effSeq < this.lastClientMatchSeq) return;
    this.lastClientMatchSeq = effSeq;
    this.currentMatchSeq = effSeq;
    this.lobby = { ...lobby, inGame: true, matchSeq: effSeq };
    this.inMatchTriggered = true;
    this.clearMatchSnapshots();
    this.onMatchStartCb?.(this.lobby);
  }

  public broadcastLobby(): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.bus?.send('*', { type: 'lobby_state', lobby: this.lobby });
  }

  public refreshPublicRooms(): void {
    this.ensurePublicDirectoryActive();
    this.dirBus?.wakeAndCheckLinks();
    this.dirBus?.send('*', { type: 'dir_query' });
    if (this.role === 'host' && this.lobby) {
      this.publishHostDirectoryState();
    }
  }

  public setHostRoomTitle(rawTitle: string): void {
    if (this.role !== 'host' || !this.lobby) return;
    const hostMem = this.lobby.members.find((m) => m.isHost) || this.lobby.members[0];
    this.lobby.roomTitle = this.normalizeRoomTitle(rawTitle, hostMem?.callsign || SaveManager.get().callsign);
    this.broadcastLobby();
    this.publishHostDirectoryState();
    this.notifyLobby();
  }

  private appendRoomChat(entry: RoomChatEntry): void {
    if (!entry || !entry.text) return;
    if (this.roomChatLog.some((x) => x.id === entry.id)) return;
    this.roomChatLog.push(entry);
    if (this.roomChatLog.length > 30) {
      this.roomChatLog.splice(0, this.roomChatLog.length - 30);
    }
    this.notifyLobby();
  }

  public sendRoomChat(rawText: string): void {
    if (!this.isActiveCoop() || !this.lobby) return;
    const text = rawText.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
    if (!text) return;
    const me = this.lobby.members.find((m) => m.peerId === this.myPeerId);
    const save = SaveManager.get();
    const entry: RoomChatEntry = {
      id: `${this.myPeerId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      peerId: this.myPeerId,
      callsign: me?.callsign || save.callsign,
      heroClass: me?.heroClass || save.selectedHero,
      text,
      ts: Date.now(),
    };
    this.appendRoomChat(entry);
    this.sendGameMessage({ type: 'lobby_chat', entry });
  }

  public kickLobbyMember(targetPeerId: string): void {
    if (this.role !== 'host' || !this.lobby || targetPeerId === this.myPeerId) return;
    const idx = this.lobby.members.findIndex((m) => m.peerId === targetPeerId);
    if (idx < 0) return;
    const [removed] = this.lobby.members.splice(idx, 1);
    const kickMsg: CoopNetMessage = { type: 'room_kick', targetPeerId, reason: '已被房主移出房间' };
    this.trySendRtc(targetPeerId, kickMsg);
    this.bus?.send(targetPeerId, kickMsg);
    this.bus?.send('*', kickMsg);
    this.closeRtcPeer(targetPeerId);
    this.clientLastSeen.delete(targetPeerId);
    this.pendingHostClientPosRaw.delete(targetPeerId);
    if (this.lobby.inGame) {
      this.onPeerLeaveCb?.(targetPeerId);
    }
    const sysEntry: RoomChatEntry = {
      id: `sys_kick_${targetPeerId}_${Date.now().toString(36)}`,
      peerId: 'system',
      callsign: '系统',
      text: `${removed.callsign} 已被移出房间`,
      ts: Date.now(),
      system: true,
    };
    this.appendRoomChat(sysEntry);
    this.broadcastFromHost({ type: 'lobby_chat', entry: sysEntry });
    this.broadcastLobby();
    this.publishHostDirectoryState();
    this.notifyLobby();
  }

  public broadcastFromHost(msg: CoopNetMessage, excludePeerId?: string): void {
    if (this.role !== 'host' || !this.bus) return;
    if (excludePeerId && this.clientLastSeen.size <= 1 && this.clientLastSeen.has(excludePeerId)) return;
    if (msg.type === 'lobby_state' || msg.type === 'start_game' || msg.type === 'lobby_chat' || msg.type === 'room_kick') {
      this.bus.send('*', msg, excludePeerId);
      return;
    }
    const rtcWire = JSON.stringify({ f: this.myPeerId, m: msg });
    const fallback: string[] = [];
    for (const pid of this.clientLastSeen.keys()) {
      if (excludePeerId && pid === excludePeerId) continue;
      if (!this.trySendRtc(pid, msg, rtcWire)) fallback.push(pid);
    }
    if (fallback.length === 1) this.bus.send(fallback[0], msg);
    else if (fallback.length > 1) this.bus.send('*', msg, excludePeerId);
  }

  public sendToHost(msg: CoopNetMessage): void {
    if (this.role !== 'client' || !this.bus || !this.hostPeerId) return;
    if (!this.trySendRtc(this.hostPeerId, msg)) {
      this.bus.send(this.hostPeerId, msg);
    }
  }

  public sendGameMessage(msg: CoopNetMessage): void {
    if (this.role === 'host') this.broadcastFromHost(msg);
    else if (this.role === 'client') this.sendToHost(msg);
  }

  private sendRawPingPong(
    peerId: string,
    pkt: { type: '__ping'; t0: number } | { type: '__pong'; t0: number }
  ): void {
    const b = this.rtcPeers.get(peerId);
    if (b?.dcFast?.readyState === 'open' && b.dcFast.bufferedAmount <= 24_576) {
      try {
        b.dcFast.send(JSON.stringify({ f: this.myPeerId, m: pkt }));
        return;
      } catch {
        // fallback to MQTT
      }
    }
    this.bus?.send(peerId, pkt);
  }

  private handleHostEnvelope(env: RoomWireEnvelope<BusPayload>): void {
    if (this.role !== 'host' || !this.lobby) return;
    const fromId = env.from;
    const msg = env.msg;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === '__bye') {
      this.removeClientPeer(fromId);
      return;
    }
    if (this.clientLastSeen.has(fromId)) this.clientLastSeen.set(fromId, performance.now());
    if (msg.type === '__hb') return;
    if (msg.type === '__ping') {
      this.sendRawPingPong(fromId, { type: '__pong', t0: msg.t0 });
      return;
    }
    if (msg.type === '__pong') {
      const sample = Math.max(1, Math.round(performance.now() - msg.t0));
      if (sample < 5000) this.rttMs = this.rttMs > 0 ? Math.round(this.rttMs * 0.6 + sample * 0.4) : sample;
      return;
    }
    if (msg.type === '__rtc') {
      this.handleRtcSignal(fromId, msg);
      return;
    }

    if (msg.type === 'join_req') {
      const existing = this.lobby.members.find((m) => m.peerId === fromId);
      if (existing) {
        this.clientLastSeen.set(fromId, performance.now());
        this.bus?.send(fromId, { type: 'join_ack', ok: true, assignedPeerId: fromId, slot: existing.slot, lobby: this.lobby });
        this.ensureHostRtcOffer(fromId);
        return;
      }
      if (this.lobby.members.length >= 4) {
        this.bus?.send(fromId, { type: 'join_ack', ok: false, reason: '房间人数已满（最多 4 人）' });
        return;
      }

      const used = new Set(this.lobby.members.map((m) => m.slot));
      let slot = 1;
      while (used.has(slot) && slot < 4) slot++;
      const member: LobbyMember = {
        peerId: fromId,
        slot,
        callsign: (msg.callsign || `P${slot + 1}`).slice(0, 12),
        heroClass: msg.heroClass || 'blademaster',
        color: SQUAD_COLORS[slot] || '#4ade80',
        ready: true,
        isHost: false,
      };
      this.clientLastSeen.set(fromId, performance.now());
      this.lobby.members.push(member);
      this.lobby.members.sort((a, b) => a.slot - b.slot);
      this.bus?.send(fromId, { type: 'join_ack', ok: true, assignedPeerId: fromId, slot, lobby: this.lobby });
      this.ensureHostRtcOffer(fromId);
      if (this.lobby.inGame) {
        this.onPeerHotJoinCb?.(member);
      }
      this.broadcastLobby();
      this.publishHostDirectoryState();
      this.notifyLobby();
      return;
    }

    if (msg.type === 'member_update') {
      this.applyHostMemberUpdate(fromId, msg);
      return;
    }

    if (this.handleHostLobbyMsg(msg, fromId)) return;

    if (this.clientLastSeen.has(fromId)) {
      this.onGameMessageCb?.(msg, fromId);
    }
  }

  private applyHostMemberUpdate(
    fromId: string,
    msg: { type: 'member_update'; ready: boolean; callsign: string; heroClass: HeroClassId }
  ): void {
    if (!this.lobby) return;
    const mem = this.lobby.members.find((m) => m.peerId === fromId);
    if (!mem) return;
    const heroChanged = Boolean(msg.heroClass && mem.heroClass !== msg.heroClass);
    const nameChanged = Boolean(msg.callsign && mem.callsign !== msg.callsign.slice(0, 12));
    mem.ready = msg.ready;
    if (msg.callsign) mem.callsign = msg.callsign.slice(0, 12);
    if (msg.heroClass) mem.heroClass = msg.heroClass;
    this.broadcastLobby();
    if (heroChanged || nameChanged) this.publishHostDirectoryState();
    this.notifyLobby();
  }

  private handleHostLobbyMsg(msg: CoopNetMessage, fromId: string): boolean {
    if (!this.lobby) return false;
    if (msg.type === 'member_update') {
      this.applyHostMemberUpdate(fromId, msg);
      return true;
    }
    if (msg.type === 'lobby_chat') {
      if (!this.clientLastSeen.has(fromId)) return true;
      const mem = this.lobby.members.find((m) => m.peerId === fromId);
      const cleanText = (msg.entry?.text || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
      if (!cleanText) return true;
      const entry: RoomChatEntry = {
        id: msg.entry?.id || `${fromId}_${Date.now().toString(36)}`,
        peerId: fromId,
        callsign: mem?.callsign || msg.entry?.callsign || '队友',
        heroClass: mem?.heroClass || msg.entry?.heroClass,
        text: cleanText,
        ts: Date.now(),
      };
      this.appendRoomChat(entry);
      this.broadcastFromHost({ type: 'lobby_chat', entry }, fromId);
      return true;
    }
    return false;
  }

  private handleClientLobbyMsg(msg: CoopNetMessage): boolean {
    if (msg.type === 'lobby_chat') {
      this.appendRoomChat(msg.entry);
      return true;
    }
    if (msg.type === 'room_kick') {
      if (msg.targetPeerId === this.myPeerId) {
        const reason = msg.reason || '已被房主移出房间';
        this.disconnect();
        this.status = 'error';
        this.errorMsg = reason;
        this.notifyLobby();
      }
      return true;
    }
    return false;
  }

  private handleClientEnvelope(env: RoomWireEnvelope<BusPayload>): void {
    if (this.role !== 'client' || env.from !== this.hostPeerId) return;
    const msg = env.msg;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === '__bye') {
      window.clearInterval(this.joinRetryTimer);
      window.clearInterval(this.heartbeatTimer);
      this.status = 'error';
      this.errorMsg = '房主已离开房间';
      this.onPeerLeaveCb?.('host');
      this.notifyLobby();
      return;
    }

    this.hostLastSeen = performance.now();
    if (msg.type === '__hb') {
      const missingSelf = !this.lobby || !this.lobby.members.some((m) => m.peerId === this.myPeerId);
      if (this.status === 'connecting' || (this.status === 'ready' && missingSelf)) {
        this.sendJoinReqThrottled(false);
      }
      return;
    }
    if (msg.type === '__ping') {
      this.sendRawPingPong(this.hostPeerId, { type: '__pong', t0: msg.t0 });
      return;
    }
    if (msg.type === '__pong') {
      const sample = Math.max(1, Math.round(performance.now() - msg.t0));
      if (sample < 5000) {
        this.rttMs =
          this.rttMs > 0 && this.rttMs < sample * 2.5
            ? Math.round(this.rttMs * 0.55 + sample * 0.45)
            : sample;
      }
      return;
    }
    if (msg.type === '__rtc') {
      this.handleRtcSignal(this.hostPeerId, msg);
      return;
    }

    if (msg.type === 'join_ack') {
      window.clearInterval(this.joinRetryTimer);
      if (!msg.ok || !msg.lobby) {
        this.status = 'error';
        this.errorMsg = msg.reason || '加入失败';
        this.notifyLobby();
        return;
      }
      this.status = 'ready';
      this.mySlot = msg.slot ?? 1;
      this.lobby = msg.lobby;
      this.startHeartbeatLoop();
      const ackSeq = this.lobby.matchSeq || 1;
      if (this.lobby.inGame && !this.inMatchTriggered && ackSeq > this.lastClientMatchSeq) {
        this.acceptClientMatchStart(this.lobby, ackSeq);
        return;
      }
      if (this.lobby.inGame && !this.inMatchTriggered) {
        this.lobby = { ...this.lobby, inGame: false };
      }
      this.notifyLobby();
      return;
    }

    if (msg.type === 'lobby_state') {
      const me = msg.lobby.members.find((m) => m.peerId === this.myPeerId);
      if (me) {
        window.clearInterval(this.joinRetryTimer);
        const wasConnecting = this.status !== 'ready';
        this.status = 'ready';
        this.mySlot = me.slot;
        this.lobby = msg.lobby;
        if (this.pendingClientHeroSync) {
          const mine = this.lobby.members.find((m) => m.peerId === this.myPeerId);
          if (mine && mine.heroClass === this.pendingClientHeroSync.heroClass) {
            this.pendingClientHeroSync = null;
          } else if (mine && performance.now() < this.pendingClientHeroSync.until) {
            mine.heroClass = this.pendingClientHeroSync.heroClass;
            this.bus?.send(this.hostPeerId, {
              type: 'member_update',
              ready: mine.ready,
              callsign: mine.callsign,
              heroClass: mine.heroClass,
            });
          } else {
            this.pendingClientHeroSync = null;
          }
        }
        if (wasConnecting) this.startHeartbeatLoop();
        const lobSeq = this.lobby.matchSeq || 1;
        if (this.lobby.inGame && !this.inMatchTriggered && lobSeq > this.lastClientMatchSeq) {
          this.acceptClientMatchStart(this.lobby, lobSeq);
          return;
        }
        if (this.lobby.inGame && !this.inMatchTriggered) {
          this.lobby = { ...this.lobby, inGame: false };
        }
        this.notifyLobby();
      } else if (msg.lobby.inGame && msg.lobby.members.length >= 4) {
        window.clearInterval(this.joinRetryTimer);
        this.lobby = null;
        this.status = 'error';
        this.errorMsg = '房间人数已满（最多 4 人）';
        this.notifyLobby();
      } else {
        if (this.status === 'ready') {
          this.lobby = null;
          this.status = 'connecting';
          this.inMatchTriggered = false;
          this.notifyLobby();
          this.sendJoinReqThrottled(true);
        } else {
          this.sendJoinReqThrottled(false);
        }
      }
      return;
    }

    if (msg.type === 'start_game') {
      if (!msg.lobby.members.some((m) => m.peerId === this.myPeerId)) return;
      this.acceptClientMatchStart(msg.lobby, msg.matchSeq || msg.lobby.matchSeq || 1);
      return;
    }

    if (
      this.status === 'ready' &&
      this.lobby &&
      !this.inMatchTriggered &&
      (msg.type === 'world_snap' || msg.type === 'heroes_fast')
    ) {
      const pktMSeq =
        msg.type === 'world_snap'
          ? msg.waveState !== 'ended'
            ? msg.mSeq || 0
            : 0
          : msg.mSeq || 0;
      if (pktMSeq > this.lastClientMatchSeq) {
        this.acceptClientMatchStart(this.lobby, pktMSeq);
      }
    }

    if (this.handleClientLobbyMsg(msg)) return;

    this.onGameMessageCb?.(msg, this.hostPeerId);
  }

  private removeClientPeer(peerId: string): void {
    const existed = this.clientLastSeen.delete(peerId);
    this.closeRtcPeer(peerId);
    this.bus?.forgetPeer(peerId);
    if (this.lobby) {
      const before = this.lobby.members.length;
      this.lobby.members = this.lobby.members.filter((m) => m.peerId !== peerId);
      if (this.lobby.members.length !== before) {
        this.broadcastLobby();
        this.publishHostDirectoryState();
        this.notifyLobby();
      }
    }
    if (existed) this.onPeerLeaveCb?.(peerId);
  }

  private startHeartbeatLoop(): void {
    window.clearInterval(this.heartbeatTimer);
    this.hostLastSeen = performance.now();
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.bus || this.role === 'offline') return;
      const now = performance.now();
      const timeoutMs = this.lobby?.inGame ? 16_000 : 45_000;
      if (this.role === 'host') {
        this.bus.send('*', { type: '__hb' });
        const first = this.clientLastSeen.keys().next().value as string | undefined;
        if (first) this.sendRawPingPong(first, { type: '__ping', t0: Math.round(now) });
        for (const [pid, t] of Array.from(this.clientLastSeen.entries())) {
          if (now - t > timeoutMs) this.removeClientPeer(pid);
        }
      } else if (this.role === 'client' && this.status === 'ready') {
        this.bus.send(this.hostPeerId, { type: '__hb' });
        this.sendRawPingPong(this.hostPeerId, { type: '__ping', t0: Math.round(now) });
        if (this.hostLastSeen > 0 && now - this.hostLastSeen > timeoutMs + 2000) {
          window.clearInterval(this.heartbeatTimer);
          this.status = 'error';
          this.errorMsg = '与房主断开连接';
          this.onPeerLeaveCb?.('host');
          this.notifyLobby();
        }
      } else if (this.role === 'client' && this.status === 'connecting') {
        this.sendJoinReqThrottled(false);
      }
    }, 2400);
  }

  private closeRtcPeer(peerId: string): void {
    const b = this.rtcPeers.get(peerId);
    if (!b) return;
    this.rtcPeers.delete(peerId);
    this.pendingHostClientPosRaw.delete(peerId);
    try { b.dcFast?.close(); } catch { /* ignore */ }
    try { b.dcCombat?.close(); } catch { /* ignore */ }
    try { b.dcRel?.close(); } catch { /* ignore */ }
    try { b.pc.close(); } catch { /* ignore */ }
  }

  private createRtcPeerBundle(peerId: string): PeerRtcBundle | null {
    if (typeof RTCPeerConnection === 'undefined') return null;
    this.closeRtcPeer(peerId);
    try {
      const pc = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });
      const bundle: PeerRtcBundle = {
        pc,
        dcFast: null,
        dcCombat: null,
        dcRel: null,
        pendingCands: [],
        remoteDescSet: false,
      };
      this.rtcPeers.set(peerId, bundle);
      pc.onicecandidate = (ev) => {
        if (ev.candidate && this.bus) this.bus.send(peerId, { type: '__rtc', cand: ev.candidate.toJSON() });
      };
      pc.ondatachannel = (ev) => this.bindRtcChannel(peerId, bundle, ev.channel);
      return bundle;
    } catch {
      return null;
    }
  }

  private bindRtcChannel(peerId: string, bundle: PeerRtcBundle, dc: RTCDataChannel): void {
    if (dc.label === 'fast') {
      bundle.dcFast = dc;
      dc.onopen = () => this.sendRawPingPong(peerId, { type: '__ping', t0: Math.round(performance.now()) });
    } else if (dc.label === 'combat') {
      bundle.dcCombat = dc;
    } else {
      bundle.dcRel = dc;
    }

    dc.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      const raw = ev.data;
      const now = performance.now();

      // Mobile Wi-Fi burst coalescing: keep only newest snapshot per render tick
      if (dc.label === 'fast') {
        if (this.role === 'client' && this.inMatchTriggered) {
          this.hostLastSeen = now;
          if (raw.includes('"world_snap"')) {
            this.pendingClientWorldRaw = raw;
            return;
          }
          if (raw.includes('"heroes_fast"')) {
            this.pendingClientHeroesRaw = raw;
            return;
          }
        } else if (this.role === 'host' && this.lobby?.inGame && this.clientLastSeen.has(peerId)) {
          if (raw.includes('"client_pos"')) {
            this.clientLastSeen.set(peerId, now);
            this.pendingHostClientPosRaw.set(peerId, raw);
            return;
          }
        }
      }

      try {
        const parsed = JSON.parse(raw) as {
          f: string;
          m: CoopNetMessage | { type: '__ping'; t0: number } | { type: '__pong'; t0: number };
        };
        if (!parsed?.m) return;
        const msg = parsed.m;
        if (msg.type === '__ping') {
          this.sendRawPingPong(peerId, { type: '__pong', t0: msg.t0 });
          return;
        }
        if (msg.type === '__pong') {
          const sample = Math.max(1, Math.round(now - msg.t0));
          if (sample < 5000) {
            this.rttMs =
              this.rttMs > 0 && this.rttMs < sample * 2.5
                ? Math.round(this.rttMs * 0.55 + sample * 0.45)
                : sample;
          }
          return;
        }
        if (this.role === 'host' && this.clientLastSeen.has(peerId)) {
          this.clientLastSeen.set(peerId, now);
          if (this.handleHostLobbyMsg(msg, peerId)) return;
          this.onGameMessageCb?.(msg, peerId);
        } else if (this.role === 'client') {
          this.hostLastSeen = now;
          if (this.handleClientLobbyMsg(msg)) return;
          if (msg.type === 'start_game') {
            if (!msg.lobby.members.some((m) => m.peerId === this.myPeerId)) return;
            this.acceptClientMatchStart(msg.lobby, msg.matchSeq || msg.lobby.matchSeq || 1);
            return;
          }
          if (
            this.status === 'ready' &&
            this.lobby &&
            !this.inMatchTriggered &&
            (msg.type === 'world_snap' || msg.type === 'heroes_fast')
          ) {
            const pktMSeq =
              msg.type === 'world_snap'
                ? msg.waveState !== 'ended'
                  ? msg.mSeq || 0
                  : 0
                : msg.mSeq || 0;
            if (pktMSeq > this.lastClientMatchSeq) {
              this.acceptClientMatchStart(this.lobby, pktMSeq);
            }
          }
          this.onGameMessageCb?.(msg, this.hostPeerId);
        }
      } catch {
        // ignore
      }
    };
  }

  private ensureHostRtcOffer(clientPeerId: string): void {
    if (this.role !== 'host' || typeof RTCPeerConnection === 'undefined') return;
    const cur = this.rtcPeers.get(clientPeerId);
    if (
      cur &&
      cur.pc.connectionState !== 'failed' &&
      cur.pc.connectionState !== 'closed' &&
      cur.pc.iceConnectionState !== 'failed' &&
      cur.pc.iceConnectionState !== 'disconnected'
    ) {
      return;
    }
    const bundle = this.createRtcPeerBundle(clientPeerId);
    if (!bundle) return;
    try {
      const dcFast = bundle.pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
      const dcCombat = bundle.pc.createDataChannel('combat', { ordered: false, maxRetransmits: 2 });
      const dcRel = bundle.pc.createDataChannel('rel', { ordered: true });
      this.bindRtcChannel(clientPeerId, bundle, dcFast);
      this.bindRtcChannel(clientPeerId, bundle, dcCombat);
      this.bindRtcChannel(clientPeerId, bundle, dcRel);
      bundle.pc
        .createOffer()
        .then((offer) => bundle.pc.setLocalDescription(offer).then(() => offer))
        .then((offer) => {
          if (this.rtcPeers.get(clientPeerId) === bundle && this.bus) {
            this.bus.send(clientPeerId, { type: '__rtc', sdp: { type: offer.type, sdp: offer.sdp } });
          }
        })
        .catch(() => {
          // fallback seamlessly to MQTT
        });
    } catch {
      // ignore
    }
  }

  private handleRtcSignal(
    fromId: string,
    sig: { type: '__rtc'; sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit }
  ): void {
    let bundle = this.rtcPeers.get(fromId);
    if (sig.sdp) {
      if (sig.sdp.type === 'offer' && this.role === 'client') {
        bundle = this.createRtcPeerBundle(fromId) || undefined;
        if (!bundle) return;
        const bRef = bundle;
        bRef.pc
          .setRemoteDescription(sig.sdp)
          .then(async () => {
            bRef.remoteDescSet = true;
            for (const c of bRef.pendingCands.splice(0)) await bRef.pc.addIceCandidate(c).catch(() => {});
            const ans = await bRef.pc.createAnswer();
            await bRef.pc.setLocalDescription(ans);
            if (this.rtcPeers.get(fromId) === bRef && this.bus) {
              this.bus.send(fromId, { type: '__rtc', sdp: { type: ans.type, sdp: ans.sdp } });
            }
          })
          .catch(() => {});
      } else if (sig.sdp.type === 'answer' && this.role === 'host' && bundle) {
        const bRef = bundle;
        bRef.pc
          .setRemoteDescription(sig.sdp)
          .then(async () => {
            bRef.remoteDescSet = true;
            for (const c of bRef.pendingCands.splice(0)) await bRef.pc.addIceCandidate(c).catch(() => {});
          })
          .catch(() => {});
      }
      return;
    }
    if (sig.cand && sig.cand.candidate && bundle) {
      if (bundle.remoteDescSet) bundle.pc.addIceCandidate(sig.cand).catch(() => {});
      else bundle.pendingCands.push(sig.cand);
    }
  }

  private trySendRtc(peerId: string, msg: CoopNetMessage, preSerialized?: string): boolean {
    if (
      msg.type === 'lobby_state' ||
      msg.type === 'start_game' ||
      msg.type === 'join_req' ||
      msg.type === 'join_ack' ||
      msg.type === 'member_update' ||
      msg.type === 'lobby_chat' ||
      msg.type === 'room_kick'
    ) {
      return false;
    }
    const b = this.rtcPeers.get(peerId);
    if (!b) return false;
    const isSnap = isSnapshotFastMsg(msg);
    const isCombat = isCombatUnorderedMsg(msg);
    const ch = isSnap
      ? b.dcFast
      : isCombat
        ? b.dcCombat?.readyState === 'open'
          ? b.dcCombat
          : b.dcRel
        : b.dcRel;
    if (!ch || ch.readyState !== 'open') return false;
    if (ch.bufferedAmount > 32_768) return isSnap;
    try {
      ch.send(preSerialized || JSON.stringify({ f: this.myPeerId, m: msg }));
      return true;
    } catch {
      return false;
    }
  }

  private notifyLobby(): void {
    this.onLobbyChangeCb?.();
  }
}

export const CoopManager = new CoopNetworkManager();
