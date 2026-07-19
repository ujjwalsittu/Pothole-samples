/**
 * Minimal snackbar/toast system. Wrap the app in <ToastProvider>; call
 * useToast().show(message, tone). Toasts slide up from the bottom (reanimated)
 * and auto-dismiss.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeOutDown, SlideInDown } from 'react-native-reanimated';
import { colors, font, radius, spacing } from '@/theme';

export type ToastTone = 'info' | 'success' | 'danger' | 'warning';

interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const TONE_BG: Record<ToastTone, string> = {
  info: '#0C4A6E',
  success: '#14532D',
  danger: '#7F1D1D',
  warning: '#78350F',
};

const TONE_FG: Record<ToastTone, string> = {
  info: '#7DD3FC',
  success: '#86EFAC',
  danger: '#FCA5A5',
  warning: '#FCD34D',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const show = useCallback((message: string, tone: ToastTone = 'info') => {
    idRef.current += 1;
    setToast({ id: idRef.current, message, tone });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View
          key={toast.id}
          entering={SlideInDown.springify().damping(18)}
          exiting={FadeOutDown.duration(200)}
          style={[styles.toast, { backgroundColor: TONE_BG[toast.tone] }]}
        >
          <Pressable onPress={() => setToast(null)}>
            <Text style={[styles.text, { color: TONE_FG[toast.tone] }]}>{toast.message}</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: spacing.xl + spacing.lg,
    left: spacing.md,
    right: spacing.md,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#FFFFFF22',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { fontSize: font.small, fontWeight: '600', textAlign: 'center' },
});
