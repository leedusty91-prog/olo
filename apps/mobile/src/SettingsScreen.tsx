import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { getItem, setItem } from "./storage";
import { TOUCH, colors, pixelBox, pixelBubble, spacing, type } from "./theme";
import { CLEARTEXT_WARNING, PLACEHOLDER_BASE, Settings } from "./api";

const KEY = "olo.settings";

export async function loadSettings(): Promise<Settings> {
  const raw = await getItem(KEY);
  if (!raw) return { baseUrl: "", token: "", allowCleartext: false };
  const parsed = JSON.parse(raw) as Settings;
  return {
    baseUrl: parsed.baseUrl || "",
    token: parsed.token || "",
    allowCleartext: Boolean(parsed.allowCleartext),
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await setItem(KEY, JSON.stringify(settings));
}

export function SettingsScreen({
  initial,
  onDone,
}: {
  initial: Settings;
  onDone: (settings: Settings) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [token, setToken] = useState(initial.token);
  const [allowCleartext, setAllowCleartext] = useState(initial.allowCleartext);

  useEffect(() => {
    setBaseUrl(initial.baseUrl);
    setToken(initial.token);
    setAllowCleartext(initial.allowCleartext);
  }, [initial]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>API 地址</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={PLACEHOLDER_BASE}
        value={baseUrl}
        onChangeText={setBaseUrl}
        style={styles.input}
      />
      <Text style={styles.label}>Token</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        value={token}
        onChangeText={setToken}
        style={styles.input}
      />
      <View style={styles.row}>
        <Text style={styles.label}>允许明文</Text>
        <Switch value={allowCleartext} onValueChange={setAllowCleartext} />
      </View>
      {allowCleartext ? <Text style={styles.warn}>{CLEARTEXT_WARNING}</Text> : null}
      <Pressable
        style={styles.button}
        onPress={() => onDone({ baseUrl: baseUrl.trim(), token: token.trim(), allowCleartext })}
      >
        <Text style={styles.buttonText}>保存</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.bg },
  label: { fontSize: type.sm, color: colors.muted, marginTop: spacing.xs },
  input: { ...pixelBubble, minHeight: TOUCH, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.card, color: colors.ink, fontSize: type.md },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: TOUCH },
  warn: { color: colors.error, lineHeight: 20, fontSize: type.xs },
  button: { ...pixelBox, marginTop: spacing.md, backgroundColor: colors.mintDark, minHeight: TOUCH + 4, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#FFF3DC", fontSize: type.md },
});
