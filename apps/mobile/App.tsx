import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";

import { Settings } from "./src/api";
import { HomeScreen } from "./src/HomeScreen";
import { InsightsScreen } from "./src/InsightsScreen";
import { NotebookScreen } from "./src/NotebookScreen";
import { OnboardingScreen } from "./src/OnboardingScreen";
import { GardenScreen } from "./src/GardenScreen";
import { ProfileScreen } from "./src/ProfileScreen";
import { SettingsScreen, loadSettings, saveSettings } from "./src/SettingsScreen";
import { loadOnboarded } from "./src/onboarding";
import { getItem, setItem } from "./src/storage";
import { colors } from "./src/theme";

type TabKey = "home" | "notebook" | "insights" | "garden" | "profile";

const SESSION_KEY = "olo.session";

const TABS: { key: TabKey; label: string }[] = [
  { key: "home", label: "陪伴" },
  { key: "notebook", label: "日记" },
  { key: "insights", label: "洞察" },
  { key: "garden", label: "花园" },
  { key: "profile", label: "我的" },
];

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("home");
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    loadSettings().then((loaded) => {
      setSettings(loaded);
      setEditing(!loaded.baseUrl || !loaded.token);
    });
    loadOnboarded().then(setOnboarded);
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

  if (!settings || onboarded === null) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (editing) {
    return (
      <SafeAreaView style={styles.app}>
        <StatusBar style="dark" />
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

  if (!sessionId) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!onboarded) {
    return (
      <SafeAreaView style={styles.app}>
        <StatusBar style="dark" />
        <OnboardingScreen settings={settings} onDone={() => setOnboarded(true)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <View style={[styles.page, tab !== "home" && styles.hidden]}>
          <HomeScreen
            settings={settings}
            sessionId={sessionId}
            onOpenSettings={() => setEditing(true)}
            active={tab === "home"}
          />
        </View>
        <View style={[styles.page, tab !== "notebook" && styles.hidden]}>
          <NotebookScreen
            settings={settings}
            sessionId={sessionId}
            onOpenSettings={() => setEditing(true)}
            active={tab === "notebook"}
          />
        </View>
        <View style={[styles.page, tab !== "insights" && styles.hidden]}>
          <InsightsScreen
            settings={settings}
            sessionId={sessionId}
            onOpenSettings={() => setEditing(true)}
            active={tab === "insights"}
          />
        </View>
        <View style={[styles.page, tab !== "garden" && styles.hidden]}>
          <GardenScreen
            settings={settings}
            onOpenSettings={() => setEditing(true)}
            active={tab === "garden"}
          />
        </View>
        <View style={[styles.page, tab !== "profile" && styles.hidden]}>
          <ProfileScreen
            settings={settings}
            onOpenSettings={() => setEditing(true)}
            active={tab === "profile"}
          />
        </View>
      </View>

      <View style={styles.tabBar}>
        {TABS.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={styles.tab}
              hitSlop={6}
            >
              <View style={[styles.dot, active && styles.dotActive]} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  content: { flex: 1 },
  page: { flex: 1 },
  hidden: { display: "none" },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
    paddingVertical: 10,
  },
  tab: { flex: 1, alignItems: "center", gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "transparent" },
  dotActive: { backgroundColor: colors.accent },
  tabText: { color: colors.muted, fontSize: 12 },
  tabTextActive: { color: colors.accent, fontWeight: "600" },
});
