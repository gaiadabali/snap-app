import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The tax rule set chosen at registration, held until onboarding can send it.
 *
 * Registration and onboarding are two different screens either side of a
 * session being created, and `SessionGate` swaps the whole tree between them —
 * there is no component alive across the hop to hold the answer in state.
 *
 * Disk rather than a module variable because the gap is not guaranteed to be
 * instant: a new account that closes the app between creating it and naming
 * the household comes back to onboarding with the session restored, and the
 * country it picked should still be there.
 *
 * Cleared as soon as it is spent, so a second workspace made later does not
 * silently inherit the first one's country.
 */
const KEY = 'snap.pendingTaxRulesId';

export async function rememberCountry(rulesId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, rulesId);
  } catch {
    /* Losing it means onboarding installs no engine, which is a real and
       recoverable state — Settings can install one. Never fail signup. */
  }
}

export async function takePendingCountry(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v) await AsyncStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}
