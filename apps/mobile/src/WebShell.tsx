import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";

import type { Settings } from "./api";
import { SettingsScreen, loadSettings, saveSettings } from "./SettingsScreen";

const BG = "#f6ead2";

function originOf(url: string): string {
  const m = /^(https?:\/\/[^/]+)/i.exec(url);
  return m ? m[1].toLowerCase() : "";
}

/** 在页面脚本运行前把 token 写进网页的 localStorage（不进 URL，不进日志）。 */
export function bootScript(token: string): string {
  return `(function(){try{localStorage.setItem("olo.token", ${JSON.stringify(JSON.stringify(token))});}catch(e){}window.OLO_NATIVE_SHELL=true;})();true;`;
}

export function WebShell() {
  return (
    <SafeAreaProvider>
      <ShellRoot />
    </SafeAreaProvider>
  );
}

function ShellRoot() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const ref = useRef<WebView>(null);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setEditing(!s.baseUrl || !s.token);
    });
  }, []);

  // Android 返回键：网页里能退就退
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack && ref.current) { ref.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const base = settings ? settings.baseUrl.replace(/\/$/, "") : "";
  const appOrigin = originOf(base);

  const onRequest = useCallback((req: { url: string }) => {
    if (!/^https?:/i.test(req.url) || originOf(req.url) !== appOrigin) {
      if (!/^(about:|data:|blob:)/i.test(req.url)) Linking.openURL(req.url).catch(() => {});
      return false;
    }
    return true;
  }, [appOrigin]);

  if (!settings) return <View style={styles.center}><ActivityIndicator /></View>;

  if (editing) {
    return (
      <SafeAreaView style={styles.fill}>
        <StatusBar style="dark" />
        <SettingsScreen
          initial={settings}
          onDone={async (next) => { await saveSettings(next); setSettings(next); setFailed(false); setEditing(false); }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.fill} edges={["top", "bottom", "left", "right"]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {failed ? (
          <View style={styles.center}>
            <Text style={styles.msg}>连不上 olo 服务器</Text>
            <Pressable style={styles.btn} onPress={() => { setFailed(false); ref.current?.reload(); }}><Text>重试</Text></Pressable>
            <Pressable style={styles.btn} onPress={() => setEditing(true)}><Text>改服务器设置</Text></Pressable>
          </View>
        ) : (
          <WebView
            ref={ref}
            testID="olo-web"
            source={{ uri: `${base}/app/` }}
            style={styles.fill}
            originWhitelist={["http://*", "https://*"]}
            injectedJavaScriptBeforeContentLoaded={bootScript(settings.token)}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
            allowsBackForwardNavigationGestures
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={onRequest}
            onNavigationStateChange={(n: WebViewNavigation) => setCanGoBack(n.canGoBack)}
            onError={() => setFailed(true)}
            onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
            startInLoadingState
            renderLoading={() => <View style={[styles.center, StyleSheet.absoluteFill]}><ActivityIndicator /></View>}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: BG, gap: 12 },
  msg: { fontSize: 16, color: "#5a4632" },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 2, borderColor: "#5a4632", backgroundColor: "#fff8ea" },
});
