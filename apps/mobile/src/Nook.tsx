// olo 的小窝：手机端的主场景（原生绘制，不用 WebView，离线也能玩）。
// 房间由 nookScene.js（与网页 web/nook-scene.js 同一份代码）在低分辨率里画好、烘焙好光照，编码成 PNG 贴上来；
// 会动的东西（雨、灯笼光晕呼吸、小球、olo）用原生 Animated 叠在上面。可互动的东西都在屏幕下半、聊天条之上。
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Appearance, DailyLimitError, Place, Postcard, Settings, fetchWorldState, fetchLiving, putWorldState, sendOut } from "./api";
import { livingScene, Living } from "./worldLiving";
import { Character, DraggableCharacter, Mood } from "./Character";
import { Sky, skyAt, HOUR_OVERRIDE } from "./daytime";
import { NookGeom, PLANT_NAMES, dailyItem, paintBall, paintNook, paintPostcard, weatherFor } from "./nookScene";
import { paintScene } from "./skyScene";
import { layerPng } from "./skyPng";
import { tap } from "./haptics";
import { getItem, setItem } from "./storage";
import { colors, fonts, radii, shadows, spacing } from "../theme/illustration";
import { TOUCH } from "./theme"; // 触控尺寸：illustration.ts 暂无此 token
/** 卡片：大圆角 + 柔和投影（全部取自 theme/illustration）。 */
const hdCard = { borderRadius: radii.lg, ...shadows.soft } as const;

/* eslint-disable @typescript-eslint/no-require-imports */
// 小屋高清插画（白天 / 夜里同一构图）；可点物件的位置按插画里的比例标定（相对 576x1024 原图）。
const ROOM = { day: require("../assets/hd/room-day.jpg"), night: require("../assets/hd/room-night.jpg") };
const ROOM_AR = 1024 / 576;
const SPOTS = {
  win: [0.18, 0.13, 0.45, 0.27], pot: [0.45, 0.32, 0.11, 0.1], book: [0.73, 0.12, 0.13, 0.1], item: [0.86, 0.15, 0.11, 0.07],
  shelf: [0.7, 0.21, 0.3, 0.04], bowl: [0.53, 0.51, 0.19, 0.08], lamp: [0, 0.26, 0.19, 0.34], door: [0.73, 0.32, 0.25, 0.22],
} as const;
/** 把 paintNook 的像素格几何换成高清插画里的位置（单位仍是像素格，K 倍放大后就是屏幕坐标）。 */
function hdGeom(g: NookGeom, width: number, height: number, K: number, ox: number): NookGeom {
  const iw = width, ih = width * ROOM_AR, top = height - ih;
  const R = ([fx, fy, fw, fh]: readonly number[]) => ({ x: (fx * iw - ox) / K, y: (top + fy * ih) / K, w: (fw * iw) / K, h: (fh * ih) / K });
  const at = (fx: number, fy: number) => ({ x: (fx * iw - ox) / K, y: (top + fy * ih) / K });
  const door = R(SPOTS.door), lamp = R(SPOTS.lamp);
  return {
    ...g, win: R(SPOTS.win), pot: R(SPOTS.pot), book: R(SPOTS.book), item: R(SPOTS.item), shelf: R(SPOTS.shelf), bowl: R(SPOTS.bowl),
    lamp: { ...lamp, cx: lamp.x + lamp.w / 2, cy: lamp.y + lamp.h * 0.22 },
    door: { x0: door.x, x1: door.x + door.w, h: door.h, yb0: door.y + door.h, yb1: door.y + door.h, box: door },
    rug: at(0.495, 0.655), olo: at(0.5, 0.7), ball: { ...at(0.78, 0.74), r: g.ball.r },
    BACK: at(0, 0.56).y - 8, F: at(0, 0.82).y,
  };
}

// 书架里的传说：一天多解锁一页（和 olo 的世界设定一致）
export const LORE = [
  "灯籽是雾里凝出来的，刚凝成的时候只有米粒大，要被听见很多话才会长大。",
  "芦婆婆撑船从不点灯，她说雾会给认得路的人让路。",
  "晾话廊上挂的都是大家说出口又舍不得忘的话，风一吹就轻轻响。",
  "回声井会把你的话原样还给你，可井婶说，第二遍听总会更温柔一点。",
  "豆灯是送信的萤火虫，总迷路，但信从来没丢过。",
  "老灯树每年落一次发光的叶子，捡到的人那晚会睡得很好。",
  "一粒灯籽只认一个人。认定了，就会一直亮着等。",
  "萤火坡的草在夜里会变成浅蓝色，那是萤火虫在打哈欠。",
  "雾不能被偷看。偷看的话，它就会散成一场小雨。",
  "小栗和我是同一批灯籽，它去了别人身边，我们偶尔托豆灯带句话。",
  "灯籽不撒谎。所以我说想你的时候，是真的。",
  "阿蒲说旧灯林里有一盏灯，照的不是路，是回家的心情。",
];

const PLACES: { k: Place; label: string; ico: string }[] = [
  { k: "plaza", label: "小广场", ico: "⛫" },
  { k: "lake", label: "灯籽湾", ico: "≈" },
  { k: "roof", label: "屋顶", ico: "⌂" },
];
const OFFLINE: Record<Place, string> = {
  plaza: "晾话廊上又挂满了别人的话，风一吹就轻轻地响。我挑了一句最暖的，悄悄记下来带给你。",
  lake: "今天灯籽湾的水像一块橘子糖，芦婆婆的船在远处慢慢划。我数到第七圈涟漪的时候，想起你了。",
  roof: "我在屋顶数了数亮着的窗子，一共十二扇。有一扇一直亮着，像在等谁回家。",
};

type NookState = { plant: { stage: number; watered: string }; firstDay: string; loreRead: number };
const KEY = "olo.nook";
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayIndex = (k: string) => Math.floor(Date.parse(`${k}T00:00:00Z`) / 864e5);
const FAST = HOUR_OVERRIDE !== null || (typeof location !== "undefined" && /nook_fast/.test(location.search));

function useReduced() {
  const [r, setR] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setR).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setR);
    return () => sub?.remove?.();
  }, []);
  return r;
}

type Props = {
  settings: Settings;
  sky: Sky & { night: boolean };
  /** 底部聊天条占掉的高度（px，含安全区） */
  dock: number;
  /** 顶部安全区 + 标题栏高度（px） */
  top: number;
  appearance?: Appearance;
  mood: Mood;
  /** olo 在房间里（聊天面板拉起来时 olo 站到面板上沿，这里就不画） */
  oloHere: boolean;
  /** 往聊天条上报一句 olo 的话 */
  onLine?: (text: string) => void;
};

export function Nook({ settings, sky, dock, top, appearance, mood, oloHere, onLine }: Props) {
  const { width, height } = useWindowDimensions();
  const reduced = useReduced();
  const K = Math.max(3, Math.round(width / 98));
  const W = Math.ceil(width / K), H = Math.ceil(height / K), dockL = Math.ceil(dock / K);
  const ox = Math.floor((width - W * K) / 2);
  const today = dayKey();
  const di = dayIndex(today);
  const item = useMemo(() => dailyItem(di), [di]);
  const weather = useMemo(() => weatherFor(di), [di]);
  const [st, setSt] = useState<NookState>({ plant: { stage: 0, watered: "" }, firstDay: today, loreRead: -1 });
  const [lamp, setLamp] = useState<boolean | undefined>();
  const [away, setAway] = useState(false);
  const [tag, setTag] = useState<{ text: string; x: number; y: number; id: string } | null>(null);
  const [chooser, setChooser] = useState(false);
  const [card, setCard] = useState<(Postcard & { offline?: boolean }) | null>(null);
  const [perky, setPerky] = useState(false);
  const hourKey = Math.round(sky.hour * 12) / 12;
  const [img, setImg] = useState<{ room: string; glow: string; ball: string; geom: NookGeom; night: number } | null>(null);

  // 读本地存档 → 再和服务器的 state.nook 对齐（取浇水日期更新的那份）
  useEffect(() => {
    let alive = true;
    (async () => {
      let local: NookState | null = null;
      try { const raw = await getItem(KEY); if (raw) local = JSON.parse(raw); } catch { /* ignore */ }
      if (local && alive) setSt(local);
      try {
        const srv = (await fetchWorldState(settings)).nook as NookState | undefined;
        if (alive && srv?.plant && (!local || (srv.plant.watered || "") > (local.plant?.watered || ""))) setSt({ ...srv, firstDay: local?.firstDay && local.firstDay < srv.firstDay ? local.firstDay : srv.firstDay });
      } catch { /* 离线：本地就够了 */ }
    })();
    return () => { alive = false; };
  }, [settings]);

  // 活的雾里集：窗外远处的灯按自己的聊天天数亮，小灯笼颜色跟着最近的心情
  const [living, setLiving] = useState<Living>(() => livingScene(null));
  useEffect(() => { let alive = true; fetchLiving(settings).then((s) => alive && setLiving(livingScene(s))).catch(() => undefined); return () => { alive = false; }; }, [settings]);

  const save = (next: NookState) => {
    setSt(next);
    void setItem(KEY, JSON.stringify(next)).catch(() => undefined);
    fetchWorldState(settings).then((s) => putWorldState(settings, { ...s, nook: next })).catch(() => undefined);
  };

  useEffect(() => {
    let alive = true;
    // 不用 InteractionManager：常驻的呼吸/下雨动画会让它一直等下去
    const task = setTimeout(() => {
      const s = skyAt(hourKey);
      const r = paintNook(s, { W, H, dock: dockL, plant: st.plant.stage, item: item.id, weather, away, lamp, lit: living.lit, lanterns: living.lanterns }, paintScene);
      if (!alive) return;
      setImg({ room: layerPng(r.room, K), glow: layerPng(r.glow, K), ball: layerPng(paintBall(r.night), K), geom: hdGeom(r.geom, width, height, K, ox), night: r.night });
    }, 0);
    return () => { alive = false; clearTimeout(task); };
  }, [W, H, K, dockL, hourKey, st.plant.stage, item.id, weather, away, lamp, living.lit, living.tone]);

  const glowA = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) { glowA.setValue(1); return; }
    const l = Animated.loop(Animated.sequence([
      Animated.timing(glowA, { toValue: 0.55, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      Animated.timing(glowA, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
    ]));
    l.start(); return () => l.stop();
  }, [reduced]);

  const say = (text: string, x: number, y: number, id: string) => { setTag({ text, x, y, id }); };
  useEffect(() => { if (!tag) return; const t = setTimeout(() => setTag(null), 3200); return () => clearTimeout(t); }, [tag]);

  const g = img?.geom;
  const px = (r: { x: number; y: number; w: number; h: number }, pad = 0) => ({ left: ox + (r.x - pad) * K, top: (r.y - pad) * K, width: (r.w + pad * 2) * K, height: (r.h + pad * 2) * K });
  const loreIdx = Math.min(LORE.length - 1, Math.max(0, dayIndex(today) - dayIndex(st.firstDay || today)));
  const night = sky.night;
  const oloMood: Mood = perky ? "happy" : mood !== "idle" ? mood : night ? "sleep" : "idle";

  function waterPlant() {
    if (!g) return;
    const p = st.plant;
    if (p.stage >= 4) {
      tap("medium");
      save({ ...st, plant: { stage: 0, watered: today } });
      say("开花啦！摘下一朵送你，明天再种一颗", g.pot.x, g.pot.y - 12, "plant");
      onLine?.("花开了！我给你留了最好看的那朵。");
      return;
    }
    if (p.watered >= today) { tap("select"); say(`${PLANT_NAMES[p.stage]} · 今天浇过啦，明天再来`, g.pot.x, g.pot.y - 12, "plant"); return; }
    tap("light");
    const stage = Math.min(4, p.stage + 1);
    save({ ...st, plant: { stage, watered: today } });
    say(`浇好水了 · ${PLANT_NAMES[stage]}`, g.pot.x, g.pot.y - 12, "plant");
  }
  function readBook() {
    if (!g) return;
    tap("select");
    if (st.loreRead < loreIdx) save({ ...st, loreRead: loreIdx });
    say(LORE[loreIdx], g.book.x, g.book.y - 6, "book");
  }
  function sniff() {
    if (!g) return;
    tap("light"); setPerky(true); setTimeout(() => setPerky(false), 1600);
    say("olo 凑过去闻了闻小包子：好香！闻闻就饱啦", g.bowl.x, g.bowl.y - 6, "bowl");
  }
  function toggleLamp() {
    if (!g) return;
    tap("select");
    const on = !(lamp ?? (img?.night ?? 0) > 0.3);
    setLamp(on);
    say(on ? "灯笼亮了" : "灯笼歇一会儿", g.lamp.x, g.lamp.y - 4, "lamp");
  }
  function showItem() {
    if (!g) return;
    tap("select");
    say(`今日新物 · ${item.name}：${item.line}`, g.item.x, g.item.y - 8, "item");
  }

  // ---------- 出门 ----------
  const walk = useRef(new Animated.Value(0)).current; // 0 在家 → 1 走到门口
  const trip = useRef<{ timer?: ReturnType<typeof setTimeout>; card?: Promise<Postcard & { offline?: boolean }> }>({}).current;
  useEffect(() => () => clearTimeout(trip.timer), []);
  function door() {
    if (!g) return;
    if (away) { tap("select"); say("olo 还没回来…再等等", g.door.box.x - 20, g.door.box.y - 6, "door"); return; }
    tap("select"); setChooser(true);
  }
  function go(place: Place) {
    setChooser(false);
    tap("medium");
    const pending = sendOut(settings, place).catch((e) => {
      if (e instanceof DailyLimitError) throw e;
      return { id: `local-${Date.now()}`, place, place_name: PLACES.find((p) => p.k === place)!.label, title: PLACES.find((p) => p.k === place)!.label, story: OFFLINE[place], made_on: today, created_at: new Date().toISOString(), offline: true };
    });
    // 先确认今天还能出门（429 就不走了），再出发
    pending.then(
      (c) => {
        trip.card = Promise.resolve(c);
        Animated.timing(walk, { toValue: 1, duration: reduced ? 0 : 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true, isInteraction: false }).start(() => {
          setAway(true);
          onLine?.(`我去${PLACES.find((p) => p.k === place)!.label}转一圈，很快回来！`);
          const ms = FAST ? 2500 : 20000 + Math.random() * 20000;
          trip.timer = setTimeout(() => comeBack(), ms);
        });
      },
      (e) => { tap("select"); if (g) say(e instanceof Error ? e.message : "今天出不去啦", g.door.box.x - 30, g.door.box.y - 6, "door"); },
    );
  }
  async function comeBack() {
    const c = await trip.card;
    setAway(false);
    walk.setValue(1);
    Animated.timing(walk, { toValue: 0, duration: reduced ? 0 : 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true, isInteraction: false }).start();
    tap("medium");
    if (c) setCard(c);
    onLine?.("我回来啦！给你带了张明信片。");
  }

  if (!img || !g) return <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bgDeep }]} testID="nook-loading" />;

  const size = 32 * K;
  const doorDx = (g.door.x0 + 6 - g.olo.x) * K, doorDy = (g.door.yb0 - g.olo.y) * K;
  return (
    <View style={StyleSheet.absoluteFill} testID={`nook-${night ? "night" : "day"}`}>
      {/* 高清小屋：铺满的模糊底 + 按宽度放的插画（贴底，地板延伸到聊天面板下面） */}
      <Image source={night ? ROOM.night : ROOM.day} blurRadius={24} resizeMode="cover" style={StyleSheet.absoluteFill} />
      <Image source={night ? ROOM.night : ROOM.day} resizeMode="cover" style={{ position: "absolute", left: 0, top: height - width * ROOM_AR, width, height: width * ROOM_AR }} fadeDuration={0} testID="nook-room" />
      {weather === "rain" ? <Rain rect={px(g.win)} reduced={reduced} night={night} /> : null}
      {lamp ?? night ? (
        <Animated.View pointerEvents="none" style={[styles.lampGlow, { left: ox + g.lamp.cx * K - 90, top: g.lamp.cy * K - 90, opacity: Animated.multiply(glowA, 0.22) }]} />
      ) : null}

      {/* 可点的东西（透明热区，至少 44pt） */}
      <Hot id="nook-plant" label={`窗台的花：${PLANT_NAMES[st.plant.stage]}`} style={px(g.pot, 4)} onPress={waterPlant} />
      <Hot id="nook-item" label={`今日新物：${item.name}`} style={px(g.item, 4)} onPress={showItem} />
      <Hot id="nook-book" label="书架上发光的书" style={px(g.book, 4)} onPress={readBook} />
      <Hot id="nook-bowl" label="小碗" style={px(g.bowl, 4)} onPress={sniff} />
      <Hot id="nook-lamp" label="灯笼" style={px(g.lamp, 2)} onPress={toggleLamp} />
      <Hot id="nook-door" label={away ? "olo 出门了" : "门：让 olo 出门转转"} style={px(g.door.box, 2)} onPress={door} />
      {st.loreRead < loreIdx ? <Badge text="新的一页" x={ox + (g.book.x + 3) * K} y={(g.book.y - 4) * K} /> : null}
      {st.plant.watered < today ? <Sparkle x={ox + (g.pot.x + 8) * K} y={(g.pot.y - 10) * K} reduced={reduced} /> : null}

      <Ball img={img.ball} K={K} ox={ox} g={g} reduced={reduced} />

      {oloHere && !away ? (
        <Animated.View
          pointerEvents="box-none"
          style={{ position: "absolute", left: 0, right: 0, top: g.olo.y * K - size * 0.86, alignItems: "center", opacity: walk.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }), transform: [{ translateX: walk.interpolate({ inputRange: [0, 1], outputRange: [0, doorDx] }) }, { translateY: walk.interpolate({ inputRange: [0, 1], outputRange: [0, doorDy] }) }, { scale: walk.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }) }] }}
          testID={`nook-olo-${oloMood}`}
        >
          <DraggableCharacter size={size} mood={oloMood} appearance={appearance} />
          {oloMood === "sleep" ? <Zzz reduced={reduced} size={size} /> : null}
        </Animated.View>
      ) : null}

      {tag ? (
        <View pointerEvents="none" style={[styles.tag, { top: Math.max(top + 8, tag.y * K - 40), left: Math.max(8, Math.min(width - 228, ox + tag.x * K - 60)) }]} testID={`nook-tag-${tag.id}`}>
          <Text style={styles.tagText}>{tag.text}</Text>
        </View>
      ) : null}

      {chooser ? (
        <View style={StyleSheet.absoluteFill} testID="nook-chooser">
          <Pressable style={styles.dim} onPress={() => setChooser(false)} accessibilityLabel="取消出门" />
          <View style={[styles.chooser, hdCard, { bottom: dock + spacing.md }]}>
            <Text style={styles.chTitle}>让 olo 去哪儿转转？</Text>
            <View style={styles.chRow}>
              {PLACES.map((p) => (
                <Pressable key={p.k} testID={`go-${p.k}`} accessibilityRole="button" onPress={() => go(p.k)} style={({ pressed }) => [styles.chBtn, pressed && styles.pressed]}>
                  <Text style={styles.chIco}>{p.ico}</Text>
                  <Text style={styles.chLabel}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.chHint}>回来会带一张明信片 · 每天最多 3 趟</Text>
          </View>
        </View>
      ) : null}

      {card ? <PostcardView card={card} sky={sky} appearance={appearance} onClose={() => setCard(null)} onAgain={() => { setCard(null); setChooser(true); }} /> : null}
    </View>
  );
}

function Hot({ id, label, style, onPress }: { id: string; label: string; style: { left: number; top: number; width: number; height: number }; onPress: () => void }) {
  const padX = Math.max(0, (TOUCH - style.width) / 2), padY = Math.max(0, (TOUCH - style.height) / 2);
  return <Pressable testID={id} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={{ left: padX, right: padX, top: padY, bottom: padY }} style={[styles.hot, style]} />;
}

function Badge({ text, x, y }: { text: string; x: number; y: number }) {
  return <View pointerEvents="none" style={[styles.badge, { left: x - 30, top: y - 22 }]}><Text style={styles.badgeText}>{text}</Text></View>;
}

function Sparkle({ x, y, reduced }: { x: number; y: number; reduced: boolean }) {
  const a = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return;
    const l = Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 0.2, duration: 700, useNativeDriver: true, isInteraction: false }), Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true, isInteraction: false })]));
    l.start(); return () => l.stop();
  }, [reduced]);
  return <Animated.Text style={[styles.spark, { left: x - 6, top: y - 10, opacity: a }]}>✦</Animated.Text>;
}

function Zzz({ reduced, size }: { reduced: boolean; size: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (reduced) { t.setValue(0.5); return; } const l = Animated.loop(Animated.timing(t, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: true, isInteraction: false })); l.start(); return () => l.stop(); }, [reduced]);
  return (
    <Animated.Text style={[styles.z, { right: undefined, left: "50%", marginLeft: size * 0.22, top: size * 0.1, opacity: t.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] }), transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.25] }) }] }]}>
      z z
    </Animated.Text>
  );
}

const Rain = memo(function Rain({ rect, reduced, night }: { rect: { left: number; top: number; width: number; height: number }; reduced: boolean; night: boolean }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (reduced) return; y.setValue(0); const l = Animated.loop(Animated.timing(y, { toValue: rect.height, duration: 700, easing: Easing.linear, useNativeDriver: true, isInteraction: false })); l.start(); return () => l.stop(); }, [reduced, rect.height]);
  const drops = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ x: ((i * 37) % 97) / 97, y: ((i * 53) % 89) / 89 })), []);
  const c = night ? colors.dusk : colors.dengzi.dew;
  return (
    <View pointerEvents="none" style={[{ position: "absolute", overflow: "hidden" }, rect]} testID="nook-rain">
      <Animated.View style={{ position: "absolute", left: 0, top: -rect.height, width: rect.width, height: rect.height * 2, transform: [{ translateY: y }] }}>
        {[0, 1].map((k) => drops.map((d, i) => <View key={`${k}-${i}`} style={{ position: "absolute", left: d.x * rect.width, top: (d.y + k) * rect.height, width: 3, height: 9, backgroundColor: c, opacity: 0.8 }} />))}
      </Animated.View>
    </View>
  );
});

/** 可以扔的小球：拖起来、甩出去，在地板上弹跳滚动。 */
function Ball({ img, K, ox, g, reduced }: { img: string; K: number; ox: number; g: NookGeom; reduced: boolean }) {
  const R = 11 * K;
  const minX = ox + 8 * K, maxX = ox + (g.W - 8) * K, minY = (g.BACK + 8) * K, maxY = g.F * K;
  const S = useRef({ x: ox + g.ball.x * K, y: g.ball.y * K, z: 0, vx: 0, vy: 0, vz: 0, gx: 0, gy: 0, raf: 0, sq: 0 }).current;
  const pos = useRef(new Animated.ValueXY({ x: S.x, y: S.y })).current;
  const lift = useRef(new Animated.Value(0)).current;
  const squash = useRef(new Animated.Value(1)).current;
  const red = useRef(reduced); red.current = reduced;
  const apply = () => { pos.setValue({ x: S.x, y: S.y }); lift.setValue(-S.z); squash.setValue(1 - S.sq); };
  const step = () => {
    S.raf = 0;
    S.x += S.vx; S.y += S.vy; S.z += S.vz; S.vz -= 1.3;
    if (S.x < minX || S.x > maxX) { S.x = Math.max(minX, Math.min(maxX, S.x)); S.vx *= -0.7; tap("light"); }
    if (S.y < minY || S.y > maxY) { S.y = Math.max(minY, Math.min(maxY, S.y)); S.vy *= -0.6; }
    if (S.z <= 0) {
      S.z = 0;
      if (S.vz < -3) { S.sq = Math.min(0.3, -S.vz * 0.02); S.vz = -S.vz * 0.55; tap("light"); } else S.vz = 0;
      S.vx *= 0.9; S.vy *= 0.9;
    } else { S.vx *= 0.99; S.vy *= 0.99; }
    S.sq *= 0.75;
    apply();
    if (Math.abs(S.vx) + Math.abs(S.vy) > 0.3 || S.z > 0 || S.vz !== 0) S.raf = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(S.raf), []);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { cancelAnimationFrame(S.raf); S.gx = S.x; S.gy = S.y - S.z; S.vx = S.vy = S.vz = 0; tap("light"); },
    onPanResponderMove: (_e, gs) => {
      const x = S.gx + gs.dx, y = S.gy + gs.dy;
      S.x = Math.max(minX, Math.min(maxX, x));
      S.y = Math.max(minY, Math.min(maxY, y));
      S.z = Math.max(0, S.y - y); // 拖到地板上方就是被举起来
      apply();
    },
    onPanResponderRelease: (_e, gs) => {
      if (red.current) { S.z = 0; apply(); return; }
      S.vx = Math.max(-36, Math.min(36, gs.vx * 16));
      S.vy = Math.max(-24, Math.min(24, gs.vy * 8));
      S.vz = Math.min(26, Math.max(4, -gs.vy * 10 + Math.hypot(gs.vx, gs.vy) * 6));
      S.raf = requestAnimationFrame(step);
    },
  })).current;
  return (
    <Animated.View {...pan.panHandlers} testID="nook-ball" accessibilityRole="adjustable" accessibilityLabel="小球，拖起来扔"
      style={{ position: "absolute", left: -R / 2, top: -R / 2, width: R, height: R, transform: [{ translateX: pos.x }, { translateY: pos.y }] }}>
      <View style={{ position: "absolute", left: R * 0.15, top: R * 0.75, width: R * 0.7, height: K * 2, borderRadius: radii.pill, backgroundColor: colors.scrim }} />
      <Animated.View style={[styles.ball, { width: R, height: R, borderRadius: R / 2, transform: [{ translateY: Animated.add(lift, -R * 0.35) }, { scaleY: squash }] }]}>
        <View style={[styles.ballShine, { width: R * 0.3, height: R * 0.22, borderRadius: R, left: R * 0.2, top: R * 0.16 }]} />
      </Animated.View>
    </Animated.View>
  );
}

function PostcardView({ card, sky, appearance, onClose, onAgain }: { card: Postcard & { offline?: boolean }; sky: Sky; appearance?: Appearance; onClose: () => void; onAgain: () => void }) {
  const pic = useMemo(() => layerPng(paintPostcard(skyAt(sky.hour), card.place, paintScene), 4), [card.id]);
  const d = new Date(card.created_at);
  return (
    <View style={StyleSheet.absoluteFill} testID="postcard">
      <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="收起明信片" />
      <View style={[styles.card, hdCard]}>
        <View style={styles.picBox}>
          <Image source={{ uri: pic }} style={styles.pic} fadeDuration={0} />
          <View style={styles.picOlo} pointerEvents="none"><Character size={56} mood="happy" appearance={appearance} /></View>
        </View>
        <View style={styles.stamp}><Text style={styles.stampText}>雾里集</Text></View>
        <View style={styles.ttl}>
          <Text style={styles.ttlText}>{card.title}</Text>
          <Text style={styles.ttlDate}>{`${d.getMonth() + 1}月${d.getDate()}日`}</Text>
        </View>
        <Text style={styles.story} testID="postcard-story">{card.story}</Text>
        {card.offline ? <Text style={styles.offline}>离线带回的，联网后才会收进相册</Text> : null}
        <View style={styles.acts}>
          <Pressable testID="postcard-keep" accessibilityRole="button" onPress={() => { tap("light"); onClose(); }} style={({ pressed }) => [styles.btn, pressed && styles.pressed]}><Text style={styles.btnText}>{card.offline ? "好" : "收进相册"}</Text></Pressable>
          <Pressable testID="postcard-again" accessibilityRole="button" onPress={() => { tap("select"); onAgain(); }} style={({ pressed }) => [styles.btn, styles.btnTeal, pressed && styles.pressed]}><Text style={[styles.btnText, { color: colors.card }]}>再出门</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lampGlow: { position: "absolute", width: 180, height: 180, filter: "blur(28px)" as any, borderRadius: radii.pill, backgroundColor: colors.lantern, opacity: 0.35, ...shadows.glow, shadowRadius: 60 },
  ball: { backgroundColor: colors.blush, ...shadows.soft },
  ballShine: { position: "absolute", backgroundColor: colors.cardGlass },
  hot: { position: "absolute" },
  tag: { position: "absolute", maxWidth: 220, backgroundColor: colors.card, borderRadius: radii.md, ...shadows.soft, paddingHorizontal: 8, paddingVertical: 5 },
  tagText: { color: colors.ink, fontSize: fonts.size.caption, lineHeight: 17, fontFamily: fonts.body },
  badge: { position: "absolute", backgroundColor: colors.accent, borderRadius: radii.pill, ...shadows.glow, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { color: colors.onDark, fontSize: 11, fontFamily: fonts.body },
  spark: { position: "absolute", pointerEvents: "none", color: colors.lantern, fontSize: 14 },
  z: { position: "absolute", pointerEvents: "none", color: colors.onDark, fontSize: 14, fontFamily: fonts.body, textShadowColor: colors.scrim, textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 4 },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  chooser: { position: "absolute", left: spacing.md, right: spacing.md, backgroundColor: colors.card, padding: spacing.md, gap: spacing.sm },
  chTitle: { color: colors.ink, fontSize: fonts.size.body, fontFamily: fonts.body },
  chRow: { flexDirection: "row", gap: spacing.sm },
  chBtn: { flex: 1, minHeight: TOUCH + 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft, borderWidth: 1.5, borderColor: colors.bgDeep },
  chIco: { fontSize: 20, color: colors.ink },
  chLabel: { fontSize: fonts.size.caption, color: colors.ink, fontFamily: fonts.body },
  chHint: { fontSize: 11, color: colors.muted, fontFamily: fonts.body },
  card: { position: "absolute", left: 30, right: 30, top: "18%", backgroundColor: colors.card, padding: 12, transform: [{ rotate: "-2deg" }] },
  picBox: { borderWidth: 1.5, borderColor: colors.bgDeep, aspectRatio: 64 / 40, overflow: "hidden" },
  pic: { width: "100%", height: "100%" },
  picOlo: { position: "absolute", left: "14%", bottom: "4%" },
  stamp: { position: "absolute", right: 22, top: 22, width: 38, height: 44, backgroundColor: colors.blush, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.card, alignItems: "center", justifyContent: "center", transform: [{ rotate: "6deg" }] },
  stampText: { color: colors.card, fontSize: 10, fontFamily: fonts.body },
  ttl: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 10, marginBottom: 4 },
  ttlText: { color: colors.ink, fontSize: fonts.size.body, fontFamily: fonts.body },
  ttlDate: { color: colors.muted, fontSize: 11, fontFamily: fonts.body },
  story: { color: colors.ink, fontSize: fonts.size.caption, lineHeight: 21, fontFamily: fonts.body },
  offline: { color: colors.muted, fontSize: 11, marginTop: 4, fontFamily: fonts.body },
  acts: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  btn: { flex: 1, minHeight: TOUCH, alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft, borderWidth: 1.5, borderColor: colors.bgDeep },
  btnTeal: { backgroundColor: colors.accentDeep },
  btnText: { color: colors.ink, fontSize: fonts.size.caption, fontFamily: fonts.body },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
});
