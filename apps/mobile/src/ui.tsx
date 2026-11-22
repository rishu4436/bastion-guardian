import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Tone } from "./lib/model";
import type { Load } from "./lib/use-load";

export const C = {
  bg: "#0b1220",
  surface: "#111a2e",
  border: "#22304d",
  text: "#e6ecf7",
  muted: "#8a9bb8",
  accent: "#5b9cff",
  good: "#2fbf71",
  warn: "#f2b84b",
  bad: "#ef5b5b",
};

export const TONE: Record<Tone, string> = { good: C.good, warn: C.warn, bad: C.bad, muted: C.muted };

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      {title ? <Text style={s.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <View style={[s.pill, { borderColor: TONE[tone] }]}>
      <Text style={[s.pillText, { color: TONE[tone] }]}>{children}</Text>
    </View>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={s.muted}>{label}</Text>
      <Text style={s.text}>{value}</Text>
    </View>
  );
}

export function Button({
  children,
  onPress,
  kind = "primary",
  disabled,
  accessibilityLabel,
}: {
  children: string;
  onPress: () => void;
  kind?: "primary" | "ghost";
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        kind === "primary" ? { backgroundColor: C.accent } : { borderColor: C.border, borderWidth: 1 },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={[s.btnText, kind === "ghost" && { color: C.text }]}>{children}</Text>
    </Pressable>
  );
}

/** Loading / error / empty / stale states for every data view. Never shows placeholder values. */
export function Loaded<T>({
  q,
  empty,
  isEmpty,
  children,
}: {
  q: Load<T>;
  empty: string;
  isEmpty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
}) {
  if (q.data === undefined) {
    if (q.error) return <Text style={[s.text, { color: C.bad }]}>Could not load: {q.error}</Text>;
    return <ActivityIndicator color={C.accent} />;
  }
  return (
    <View>
      {q.error ? (
        <Text style={[s.small, { color: C.warn }]}>
          Showing data from {q.updatedAt ? new Date(q.updatedAt).toLocaleTimeString() : "earlier"}; refresh
          failed ({q.error}).
        </Text>
      ) : null}
      {isEmpty?.(q.data) ? <Text style={s.muted}>{empty}</Text> : children(q.data)}
    </View>
  );
}

export const s = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: { color: C.muted, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: 12 },
  text: { color: C.text, fontSize: 14 },
  muted: { color: C.muted, fontSize: 14 },
  small: { color: C.muted, fontSize: 12 },
  h1: { color: C.text, fontSize: 22, fontWeight: "600", marginBottom: 4 },
  btn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", marginTop: 8 },
  btnText: { color: "#04101f", fontWeight: "600" },
  input: {
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 10,
    color: C.text,
    padding: 10,
    marginTop: 4,
    marginBottom: 10,
  },
});
