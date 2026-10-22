import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Appearance,
  CheckIn,
  PersonaState,
  Settings,
  ShopState,
  SubscriptionState,
  activateSubscription,
  buyShopItem,
  cancelSubscription,
  cancelCheckIn,
  claimTokens,
  createCheckIn,
  fetchCheckIns,
  fetchPersona,
  fetchShop,
  fetchSubscription,
  updatePersona,
  type UserGender,
} from "./api";
import { Character } from "./Character";
import { colors, pixelBox, spacing } from "./theme";

const APPEARANCE_LABEL: Record<string, string> = {
  eyes: "眼睛",
  cheeks: "腮红",
  hair: "发型",
  voice: "声音",
  form: "形态",
};

function nextAt(hour: number, dayOffset = 0): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function formatCheckIn(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

const CHECK_IN_PRESETS: { label: string; when: () => string; recurrence: "none" | "daily" }[] = [
  { label: "今晚 20:00", when: () => nextAt(20), recurrence: "none" },
  { label: "明早 09:00", when: () => nextAt(9, 1), recurrence: "none" },
  { label: "每天 20:00", when: () => nextAt(20), recurrence: "daily" },
  { label: "1 分钟后", when: () => new Date(Date.now() + 60_000).toISOString(), recurrence: "none" },
];

const QUOTA_LABEL: Record<string, string> = {
  messages: "今天的对话",
  notebook: "今天的日记",
  insights: "今天的洞察",
};

const PLANS = [
  { id: "monthly" as const, title: "按月", price: "¥38 / 月", note: "随时取消" },
  { id: "yearly" as const, title: "按年", price: "¥268 / 年", note: "约等于每月 ¥22" },
];

export function ProfileScreen({
  settings,
  onOpenSettings,
  active = true,
}: {
  settings: Settings;
  onOpenSettings: () => void;
  active?: boolean;
}) {
  const [state, setState] = useState<SubscriptionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [paywall, setPaywall] = useState(false);
  const [persona, setPersona] = useState<PersonaState | null>(null);
  const [appearanceBusy, setAppearanceBusy] = useState(false);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [checkBusy, setCheckBusy] = useState(false);
  const [shop, setShop] = useState<ShopState | null>(null);
  const [shopBusy, setShopBusy] = useState(false);

  async function load() {
    setError(undefined);
    try {
      setState(await fetchSubscription(settings));
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取订阅失败");
    }
    try {
      setPersona(await fetchPersona(settings));
    } catch {
      // 性格读取失败时保留订阅信息
    }
    try {
      const list = await fetchCheckIns(settings);
      setCheckIns(list.upcoming);
    } catch {
      // 约定读取失败时留空
    }
    try {
      setShop(await fetchShop(settings));
    } catch {
      // 商店读取失败时留空
    }
    setLoading(false);
  }

  async function scheduleCheckIn(kind: "text" | "call", when: string, recurrence: "none" | "daily") {
    if (checkBusy) return;
    setCheckBusy(true);
    try {
      await createCheckIn(settings, { kind, scheduled_for: when, recurrence });
      const list = await fetchCheckIns(settings);
      setCheckIns(list.upcoming);
    } catch (err) {
      setError(err instanceof Error ? err.message : "约定失败");
    } finally {
      setCheckBusy(false);
    }
  }

  async function removeCheckIn(id: string) {
    if (checkBusy) return;
    setCheckBusy(true);
    try {
      await cancelCheckIn(settings, id);
      setCheckIns((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消失败");
    } finally {
      setCheckBusy(false);
    }
  }

  function lockedByGroup(group: string, value: string): boolean {
    const item = shop?.items.find(
      (candidate) => candidate.kind === group && candidate.value === value,
    );
    return Boolean(item && !item.owned);
  }

  async function claimDaily() {
    if (shopBusy) return;
    setShopBusy(true);
    try {
      await claimTokens(settings);
      setShop(await fetchShop(settings));
    } catch (err) {
      setError(err instanceof Error ? err.message : "领取失败");
    } finally {
      setShopBusy(false);
    }
  }

  async function buy(itemId: string) {
    if (shopBusy) return;
    setShopBusy(true);
    try {
      await buyShopItem(settings, itemId);
      setShop(await fetchShop(settings));
    } catch (err) {
      setError(err instanceof Error ? err.message : "购买失败");
    } finally {
      setShopBusy(false);
    }
  }

  async function chooseGender(value: UserGender) {
    if (!persona || appearanceBusy || (persona.user_gender ?? "unspecified") === value) return;
    setAppearanceBusy(true);
    try {
      setPersona(await updatePersona(settings, { user_gender: value }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setAppearanceBusy(false);
    }
  }

  async function chooseAppearance(group: string, value: string) {
    if (!persona || appearanceBusy) return;
    const current = persona.appearance as Record<string, string | undefined>;
    if (current?.[group] === value) return;
    setAppearanceBusy(true);
    try {
      setPersona(await updatePersona(settings, { appearance: { [group]: value } as Appearance }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "换外观失败");
    } finally {
      setAppearanceBusy(false);
    }
  }



  useEffect(() => {
    if (active) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, settings]);

  async function activate(plan: "monthly" | "yearly") {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setState(await activateSubscription(settings, plan));
      setPaywall(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "开通失败");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setState(await cancelSubscription(settings));
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>我的</Text>
          <Text style={styles.subtle}>订阅与今天还剩多少</Text>
        </View>
        <Pressable onPress={onOpenSettings} hitSlop={8}>
          <Text style={styles.settings}>设置</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading || !state ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.tier}>{state.is_plus ? "olo+" : "免费版"}</Text>
              <View style={[styles.pill, state.is_plus && styles.pillPlus]}>
                <Text style={[styles.pillText, state.is_plus && styles.pillTextPlus]}>
                  {state.is_plus ? "已开通" : "基础"}
                </Text>
              </View>
            </View>
            <Text style={styles.cardBody}>
              {state.is_plus
                ? "对话、日记、洞察都没有每日上限。"
                : "每天 20 轮对话、1 篇日记、1 条洞察。"}
            </Text>
            <Text style={styles.perks}>
              {state.is_plus
                ? `Plus 权益：每日代币 +${state.perks?.daily_tokens ?? 10} · 商店 ${Math.round(
                    (1 - (state.perks?.shop_discount ?? 0.2)) * 10,
                  )} 折`
                : `免费版：每日代币 +${state.perks?.daily_tokens ?? 5} · 商店原价`}
            </Text>
            {state.renews_at ? (
              <Text style={styles.renew}>
                {state.status === "canceled" ? "已取消，有效期到 " : "下次续费 "}
                {state.renews_at.slice(0, 10)}
              </Text>
            ) : null}
          </View>

          {!state.is_plus && state.limits ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>今天</Text>
              {Object.entries(state.limits).map(([key, limit]) => {
                const used = state.usage[key as keyof typeof state.usage];
                const ratio = Math.min(1, used / Math.max(1, limit));
                return (
                  <View key={key} style={styles.quotaRow}>
                    <Text style={styles.quotaLabel}>{QUOTA_LABEL[key]}</Text>
                    <Text style={styles.quotaValue}>
                      {used} / {limit}
                    </Text>
                    <View style={styles.quotaTrack}>
                      <View style={[styles.quotaFill, { width: `${ratio * 100}%` }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {state.is_plus ? (
            <Pressable onPress={cancel} disabled={busy} style={styles.secondary}>
              <Text style={styles.secondaryText}>{busy ? "处理中…" : "取消订阅"}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setPaywall(true)} style={styles.primary}>
              <Text style={styles.primaryText}>升级 olo+</Text>
            </Pressable>
          )}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>日记里怎么称呼你</Text>
            <View style={styles.appearanceChips}>
              {GENDER_OPTIONS.map(([id, label]) => {
                const selected = (persona?.user_gender ?? "unspecified") === id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => void chooseGender(id)}
                    disabled={appearanceBusy}
                    style={[styles.appearanceChip, selected && styles.appearanceChipActive]}
                  >
                    <Text style={[styles.appearanceChipText, selected && styles.appearanceChipTextActive]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>olo 的样子</Text>
            <View style={styles.preview}>
              <Character size={130} appearance={persona?.appearance} mood="idle" />
            </View>
            {Object.entries(persona?.appearance_options ?? {}).map(([group, options]) => (
              <View key={group} style={styles.appearanceGroup}>
                <Text style={styles.groupLabel}>{APPEARANCE_LABEL[group] ?? group}</Text>
                <View style={styles.appearanceChips}>
                  {options.map((option) => {
                    const selected =
                      (persona?.appearance as Record<string, string | undefined> | undefined)?.[
                        group
                      ] === option.id;
                    const locked = lockedByGroup(group, option.id);
                    return (
                      <Pressable
                        key={option.id}
                        onPress={() => {
                          if (locked) return;
                          void chooseAppearance(group, option.id);
                        }}
                        disabled={appearanceBusy || locked}
                        style={[
                          styles.appearanceChip,
                          selected && styles.appearanceChipActive,
                          locked && styles.appearanceChipLocked,
                        ]}
                      >
                        <Text
                          style={[
                            styles.appearanceChipText,
                            selected && styles.appearanceChipTextActive,
                          ]}
                        >
                          {option.label}
                          {locked ? " 🔒" : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <View style={styles.shopTop}>
              <Text style={styles.sectionTitle}>商店</Text>
              <Text style={styles.tokens}>代币 {shop?.tokens ?? 0}</Text>
            </View>
            <Text style={styles.cardBody}>用代币解锁外观；默认外观一直免费。</Text>
            <Pressable
              onPress={claimDaily}
              disabled={!shop?.can_claim || shopBusy}
              style={[styles.claimButton, !shop?.can_claim && styles.claimDisabled]}
            >
              <Text style={styles.claimText}>
                {shop?.can_claim
                  ? `每日领取 +${shop?.claim_amount ?? 5}`
                  : "今天已经领过了"}
              </Text>
            </Pressable>
            <View style={styles.shopItems}>
              {(shop?.items ?? []).map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => buy(item.id)}
                  disabled={item.owned || shopBusy}
                  style={[styles.shopChip, item.owned && styles.shopChipOwned]}
                >
                  <Text style={styles.shopChipText}>{item.name}</Text>
                  <Text style={styles.shopChipPrice}>
                    {item.owned
                      ? "已拥有"
                      : item.base_price > item.price
                        ? `${item.price} 代币（原价 ${item.base_price}）`
                        : `${item.price} 代币`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>olo 主动来找你</Text>
            <Text style={styles.cardBody}>约定一个时间，olo 会主动发来一句话。</Text>
            <View style={styles.presetRow}>
              {CHECK_IN_PRESETS.map((preset) => (
                <Pressable
                  key={preset.label}
                  disabled={checkBusy}
                  onPress={() => scheduleCheckIn("text", preset.when(), preset.recurrence)}
                  style={styles.presetChip}
                >
                  <Text style={styles.presetText}>{preset.label}</Text>
                </Pressable>
              ))}
            </View>
            {checkIns.length === 0 ? (
              <Text style={styles.checkInEmpty}>还没有约定</Text>
            ) : (
              checkIns.map((item) => (
                <View key={item.id} style={styles.checkInRow}>
                  <View style={styles.checkInInfo}>
                    <Text style={styles.checkInWhen}>{formatCheckIn(item.scheduled_for)}</Text>
                    <Text style={styles.checkInMeta}>
                      {item.kind === "call" ? "语音" : "文字"}
                      {item.recurrence === "daily" ? " · 每天" : ""}
                    </Text>
                  </View>
                  <Pressable onPress={() => removeCheckIn(item.id)} hitSlop={8}>
                    <Text style={styles.cancelCheckIn}>取消</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>

          <Text style={styles.note}>
            开发版模拟内购：不会真的扣费，也没有接 App Store。正式版这里换成 StoreKit 收据校验。
          </Text>
        </>
      )}

      <Modal visible={paywall} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>olo+</Text>
            <Text style={styles.modalBody}>对话、日记、洞察都没有每日上限。</Text>
            {PLANS.map((plan) => (
              <Pressable
                key={plan.id}
                style={styles.plan}
                disabled={busy}
                onPress={() => activate(plan.id)}
              >
                <View>
                  <Text style={styles.planTitle}>{plan.title}</Text>
                  <Text style={styles.planNote}>{plan.note}</Text>
                </View>
                <Text style={styles.planPrice}>{plan.price}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setPaywall(false)} style={styles.close}>
              <Text style={styles.closeText}>以后再说</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const GENDER_OPTIONS: [UserGender, string][] = [
  ["male", "他（男生）"],
  ["female", "她（女生）"],
  ["unspecified", "TA（不想说）"],
];

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  title: { fontSize: 26, fontWeight: "700", color: colors.ink },
  subtle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  settings: { color: colors.accent, fontSize: 14 },
  error: { color: colors.error, marginTop: spacing.sm, fontSize: 12 },
  loading: { marginTop: spacing.xl },
  card: {
    ...pixelBox,
    backgroundColor: colors.card,
    borderRadius: 0,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tier: { fontSize: 20, fontWeight: "700", color: colors.ink },
  pill: {
    backgroundColor: colors.bgDeep,
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillPlus: { backgroundColor: colors.accent },
  pillText: { color: colors.muted, fontSize: 11 },
  pillTextPlus: { color: colors.card },
  cardBody: { color: colors.ink, fontSize: 14, lineHeight: 21, marginTop: spacing.sm },
  perks: { color: colors.muted, fontSize: 11, marginTop: 6 },
  renew: { color: colors.muted, fontSize: 12, marginTop: spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: colors.ink, marginBottom: spacing.sm },
  quotaRow: { marginTop: spacing.sm },
  quotaLabel: { color: colors.ink, fontSize: 13 },
  quotaValue: { color: colors.muted, fontSize: 12, marginTop: 2 },
  quotaTrack: {
    height: 6,
    borderRadius: 0,
    backgroundColor: colors.bgDeep,
    marginTop: 6,
    overflow: "hidden",
  },
  quotaFill: { height: 6, borderRadius: 0, backgroundColor: colors.accent },
  primary: {
    ...pixelBox,
    backgroundColor: colors.accent,
    borderRadius: 0,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  primaryText: { color: colors.card, fontSize: 15, fontWeight: "700" },
  secondary: {
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 0,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  secondaryText: { color: colors.muted, fontSize: 14 },
  note: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: spacing.lg },
  toneRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  toneChip: {
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  toneChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  toneText: { color: colors.muted, fontSize: 13 },
  toneTextActive: { color: colors.accent, fontWeight: "600" },
  preview: { alignItems: "center", marginTop: spacing.sm },
  appearanceGroup: { marginTop: spacing.md },
  groupLabel: { color: colors.muted, fontSize: 11, letterSpacing: 0.6, marginBottom: 6 },
  appearanceChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  appearanceChip: {
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  appearanceChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  appearanceChipText: { color: colors.muted, fontSize: 12 },
  appearanceChipTextActive: { color: colors.accent, fontWeight: "600" },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  presetChip: {
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  presetText: { color: colors.ink, fontSize: 12 },
  checkInEmpty: { color: colors.muted, fontSize: 12, marginTop: spacing.md },
  checkInRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.bgDeep,
  },
  checkInInfo: { flex: 1 },
  checkInWhen: { color: colors.ink, fontSize: 13 },
  checkInMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  cancelCheckIn: { color: colors.error, fontSize: 12 },
  shopTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tokens: { color: colors.accent, fontSize: 14, fontWeight: "700" },
  claimButton: {
    backgroundColor: colors.accentSoft,
    borderRadius: 0,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: spacing.md,
  },
  claimDisabled: { backgroundColor: colors.bgDeep },
  claimText: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  shopItems: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  shopChip: {
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  shopChipOwned: { backgroundColor: colors.bgDeep, borderColor: colors.bgDeep },
  shopChipText: { color: colors.ink, fontSize: 12 },
  shopChipPrice: { color: colors.muted, fontSize: 10, marginTop: 2 },
  appearanceChipLocked: { opacity: 0.45 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(24,32,28,0.45)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    padding: spacing.lg,
  },
  modalTitle: { fontSize: 24, fontWeight: "700", color: colors.ink },
  modalBody: { color: colors.ink, fontSize: 14, marginTop: spacing.sm },
  plan: {
    ...pixelBox,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 0,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  planTitle: { fontSize: 16, fontWeight: "600", color: colors.ink },
  planNote: { fontSize: 11, color: colors.muted, marginTop: 2 },
  planPrice: { fontSize: 16, fontWeight: "700", color: colors.accent },
  close: { alignSelf: "center", marginTop: spacing.md, padding: spacing.sm },
  closeText: { color: colors.muted, fontSize: 13 },
});
