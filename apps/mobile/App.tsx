import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { Settings, completeOnboarding, fetchPersona } from "./src/api";
import { HomeScreen } from "./src/HomeScreen";
import { InsightsScreen } from "./src/InsightsScreen";
import { NotebookScreen } from "./src/NotebookScreen";
import { OnboardingScreen } from "./src/OnboardingScreen";
import { GardenScreen } from "./src/GardenScreen";
import { ProfileScreen } from "./src/ProfileScreen";
import { SettingsScreen, loadSettings, saveSettings } from "./src/SettingsScreen";
import { loadOnboarded, saveOnboarded, savePendingOnboarding, takePendingOnboarding } from "./src/onboarding";
import { getItem, setItem } from "./src/storage";
import { applyAppFont } from "./src/appFont";
import { tap } from "./src/haptics";
import { TOUCH, colors, fonts, radii, shadows, spacing } from "./theme/illustration";
/** 卡片：大圆角 + 柔和投影（全部取自 theme/illustration）。 */
const hdCard = { borderRadius: radii.lg, ...shadows.soft } as const;

// 纯聊天布局：主界面只有聊天（+ 右上 ☰ 菜单），其它页从菜单打开，盖在聊天上，左上「‹ 返回」。
export type PageKey = "notebook" | "insights" | "garden" | "profile";
const TITLES: Record<PageKey, string> = { notebook: "日记", insights: "洞察", garden: "花园", profile: "我的 · 商店" };

const SESSION_KEY = "olo.session";

function Loading({ label }: { label: string }) {
  return (
    <SafeAreaView style={styles.center}>
      <View style={[styles.loadCard, hdCard]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.loadText}>{label}</Text>
      </View>
    </SafeAreaView>
  );
}

function PageShell({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  const [fade] = useState(() => new Animated.Value(0));
  useEffect(() => { Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== "web" }).start(); }, []);
  return (
    <Animated.View style={[styles.pageOver, { opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      <SafeAreaView style={styles.app} edges={["top", "left", "right"]}>
        <View style={styles.pageBar}>
          <Pressable testID="back" accessibilityRole="button" accessibilityLabel="返回聊天" onPress={() => { tap("select"); onBack(); }} style={({ pressed }) => [hdCard, styles.backBtn, pressed && styles.pressed]}>
            <Text style={styles.backText}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.pageTitle} accessibilityRole="header" accessibilityLabel={title} />
          <View style={{ width: 76 }} />
        </View>
        <View style={styles.pageBody}>{children}</View>
      </SafeAreaView>
    </Animated.View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

async function flushPendingOnboarding(s: Settings): Promise<void> {
  const body = await takePendingOnboarding();
  if (!body) return;
  try {
    await completeOnboarding(s, body as never);
  } catch {
    await savePendingOnboarding(body);
  }
}

function Root() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [page, setPage] = useState<PageKey | null>(null);
  const [fontsLoaded, fontError] = useFonts({ [fonts.body]: require("./assets/fonts/LXGWWenKai.ttf") });
  if (fontsLoaded) applyAppFont();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const loaded = await loadSettings();
      setSettings(loaded);
      setEditing(!loaded.baseUrl || !loaded.token);
      let done = await loadOnboarded();
      // 相遇记在账号上：这台设备没记过，就问一下服务器
      if (!done && loaded.baseUrl && loaded.token) {
        try {
          done = Boolean((await fetchPersona(loaded)).onboarded);
          if (done) await saveOnboarded();
        } catch { /* 离线：照常走相遇 */ }
      }
      setOnboarded(done);
    })();
  }, []);

  async function openSession(next: Settings): Promise<void> {
    const response = await fetch(`${next.baseUrl.replace(/\/$/, "")}/v1/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${next.token}` },
    });
    if (!response.ok) {
      throw new Error("打不开会话");
    }
    const body = (await response.json()) as { id: string };
    setSessionId(body.id);
    flushPendingOnboarding(next);
    await setItem(SESSION_KEY, body.id);
  }

  // 有设置就直接恢复/创建会话，不用每次重新点保存。
  useEffect(() => {
    if (!settings || editing || sessionId) return;
    let alive = true;
    (async () => {
      const saved = await getItem(SESSION_KEY);
      if (saved) {
        if (alive) setSessionId(saved);
        flushPendingOnboarding(settings);
        return;
      }
      try {
        await openSession(settings);
      } catch {
        if (alive) setEditing(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, editing, sessionId]);

  if (!fontsLoaded && !fontError) return <Loading label="olo 在找字…" />;
  if (!settings || onboarded === null) return <Loading label="olo 醒过来了…" />;

  // 相遇仪式不依赖网络：先看片、起名、选样子；服务器暂时连不上也能进来，结果稍后补交。
  if (!onboarded) {
    return (
      <View style={styles.app}>
        <StatusBar style="light" />
        <OnboardingScreen settings={settings} onDone={() => setOnboarded(true)} />
      </View>
    );
  }

  if (editing) {
    const canBack = Boolean(settings.baseUrl && settings.token && sessionId);
    return (
      <SafeAreaView style={styles.app}>
        <StatusBar style="dark" />
        {canBack ? (
          <View style={styles.pageBar}>
            <Pressable testID="back" accessibilityRole="button" onPress={() => setEditing(false)} style={({ pressed }) => [hdCard, styles.backBtn, pressed && styles.pressed]}>
              <Text style={styles.backText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.pageTitle}>设置</Text>
            <View style={{ width: 76 }} />
          </View>
        ) : null}
        <SettingsScreen
          initial={settings}
          onDone={async (next) => {
            await saveSettings(next);
            setSettings(next);
            await openSession(next);
            setEditing(false);
          }}
        />
      </SafeAreaView>
    );
  }

  if (!sessionId) return <Loading label="正在接通 olo…" />;

  const openSettings = () => { setPage(null); setEditing(true); };
  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      <HomeScreen settings={settings} sessionId={sessionId} onOpenSettings={openSettings} onNavigate={(k) => setPage(k)} active={page === null} />
      {page ? (
        <PageShell title={TITLES[page]} onBack={() => setPage(null)}>
          {page === "notebook" ? <NotebookScreen settings={settings} sessionId={sessionId} onOpenSettings={openSettings} active /> : null}
          {page === "insights" ? <InsightsScreen settings={settings} sessionId={sessionId} onOpenSettings={openSettings} active /> : null}
          {page === "garden" ? <GardenScreen settings={settings} onOpenSettings={openSettings} active /> : null}
          {page === "profile" ? <ProfileScreen settings={settings} onOpenSettings={openSettings} active /> : null}
        </PageShell>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  loadCard: { backgroundColor: colors.card, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: "center", gap: spacing.sm },
  loadText: { color: colors.muted, fontSize: fonts.size.caption },
  pageOver: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg, zIndex: 30 },
  pageBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  backBtn: { borderRadius: radii.pill, minHeight: TOUCH, minWidth: 76, paddingHorizontal: spacing.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
  backText: { color: colors.ink, fontSize: fonts.size.body },
  pageTitle: { color: colors.ink, fontSize: fonts.size.title },
  pageBody: { flex: 1 },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
});
