/**
 * `TextInput` qui ne perd jamais de frappe sur un écran lourd.
 *
 * Un `TextInput` contrôlé (`value={state}`) dont le parent re-rend tout un gros écran à
 * chaque touche (formulaire commande : carte livre, devis, effets…) laisse le thread JS
 * prendre du retard ; RN réécrit alors la valeur native avec l’ancien `value` et des
 * caractères sautent (ex. « support@… » → « s@… »).
 *
 * Ici la valeur vit **localement** (re-render minuscule, synchrone), et le parent est
 * notifié avec un léger debounce — puis **flush** au blur / fin d’édition. Les mises à
 * jour programmatiques du parent (préremplissage CRM, bouton QA) sont répercutées.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

type Props = Omit<TextInputProps, 'value' | 'onChangeText' | 'defaultValue'> & {
  value: string;
  onChangeText: (v: string) => void;
  /**
   * Appelé **synchroniquement** à chaque frappe, avant le debounce — pour alimenter une ref
   * « vérité clavier » que le parent lit au submit (l’état React peut avoir jusqu’à
   * `commitDelayMs` de retard). Ne doit pas déclencher de re-render.
   */
  onChangeTextImmediate?: (v: string) => void;
  /** Délai avant de remonter au parent (défaut 160 ms). 0 = immédiat. */
  commitDelayMs?: number;
};

const DEFAULT_COMMIT_DELAY_MS = 160;

function StableTextInputImpl({
  value,
  onChangeText,
  onChangeTextImmediate,
  commitDelayMs = DEFAULT_COMMIT_DELAY_MS,
  onBlur,
  onEndEditing,
  onSubmitEditing,
  ...rest
}: Props) {
  const [local, setLocal] = useState(value);
  /** Dernière valeur envoyée (ou en attente d’envoi) au parent. */
  const lastCommittedRef = useRef(value);
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeTextRef = useRef(onChangeText);
  onChangeTextRef.current = onChangeText;
  const onChangeTextImmediateRef = useRef(onChangeTextImmediate);
  onChangeTextImmediateRef.current = onChangeTextImmediate;

  // Changement **externe** (prefill, reset) : le parent impose une valeur ≠ de ce qu’on lui a envoyé.
  useEffect(() => {
    if (value !== lastCommittedRef.current && value !== pendingRef.current) {
      lastCommittedRef.current = value;
      pendingRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setLocal(value);
    }
  }, [value]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending == null) return;
    pendingRef.current = null;
    if (pending !== lastCommittedRef.current) {
      lastCommittedRef.current = pending;
      onChangeTextRef.current(pending);
    }
  }, []);

  useEffect(() => () => flush(), [flush]);

  const handleChange = useCallback(
    (v: string) => {
      onChangeTextImmediateRef.current?.(v);
      setLocal(v);
      pendingRef.current = v;
      if (commitDelayMs <= 0) {
        flush();
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, commitDelayMs);
    },
    [commitDelayMs, flush],
  );

  return (
    <TextInput
      {...rest}
      value={local}
      onChangeText={handleChange}
      onBlur={e => {
        flush();
        onBlur?.(e);
      }}
      onEndEditing={e => {
        flush();
        onEndEditing?.(e);
      }}
      onSubmitEditing={e => {
        flush();
        onSubmitEditing?.(e);
      }}
    />
  );
}

export const StableTextInput = memo(StableTextInputImpl);
export default StableTextInput;
