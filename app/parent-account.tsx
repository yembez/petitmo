import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { LogOut, Trash2, UserRound } from 'lucide-react-native';
import ParentSubpageShell from '@/components/parentSpace/ParentSubpageShell';
import { MenuGroup, MenuRow, menuIcon } from '@/components/parentSpace/menuUi';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import {
  deleteRealAccount,
  getRealAuthUser,
  peekHasRealAuthAccount,
  peekOfflineLocalResumeActive,
  peekRealAuthEmail,
  signOutRealAccount,
} from '@/lib/authAccount';
import { resetNavigationToOnboarding } from '@/utils/resetNavigationToOnboarding';
import { beginAccountClosingUi, endAccountClosingUi } from '@/lib/accountClosingUi';

export default function ParentAccountScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useAppTranslation('common');
  const { dm500, dm600 } = useDmSansFamilyFlowFonts();
  const [accountEmail, setAccountEmail] = useState(() => peekRealAuthEmail() || '—');
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void getRealAuthUser().then((realUser) => {
        if (realUser) {
          const rawEmail =
            realUser.email ??
            (typeof realUser.user_metadata?.email === 'string' ? realUser.user_metadata.email : '') ??
            '';
          setAccountEmail(rawEmail.trim() || '—');
          return;
        }
        if (peekHasRealAuthAccount() || peekOfflineLocalResumeActive()) {
          setAccountEmail(peekRealAuthEmail() || '—');
        }
      });
    }, []),
  );

  const performSignOut = useCallback(async () => {
    if (signOutBusy || deleteBusy) return;
    setSignOutBusy(true);
    beginAccountClosingUi('signOut');
    try {
      await signOutRealAccount();
      resetNavigationToOnboarding(router, navigation);
      setTimeout(() => endAccountClosingUi(), 280);
    } catch {
      endAccountClosingUi();
      Alert.alert(t('error'), t('parent.account.signOutFailed'));
      setSignOutBusy(false);
    }
  }, [deleteBusy, navigation, router, signOutBusy, t]);

  const handleSignOut = useCallback(() => {
    if (signOutBusy || deleteBusy) return;
    Alert.alert(t('parent.account.signOutConfirmTitle'), t('parent.account.signOutConfirmBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('parent.account.signOut'),
        style: 'destructive',
        onPress: () => void performSignOut(),
      },
    ]);
  }, [deleteBusy, performSignOut, signOutBusy, t]);

  const performDeleteAccount = useCallback(async () => {
    if (deleteBusy || signOutBusy) return;
    setDeleteBusy(true);
    beginAccountClosingUi('delete');
    try {
      const result = await deleteRealAccount();
      if (!result.ok) {
        endAccountClosingUi();
        Alert.alert(t('error'), result.error);
        setDeleteBusy(false);
        return;
      }
      resetNavigationToOnboarding(router, navigation);
      setTimeout(() => endAccountClosingUi(), 280);
    } catch {
      endAccountClosingUi();
      Alert.alert(t('error'), t('parent.account.deleteFailed'));
      setDeleteBusy(false);
    }
  }, [deleteBusy, navigation, router, signOutBusy, t]);

  const handleDeleteAccount = useCallback(() => {
    if (deleteBusy || signOutBusy) return;
    if (peekOfflineLocalResumeActive()) {
      Alert.alert(t('error'), t('parent.account.deleteNeedsNetwork'));
      return;
    }
    Alert.alert(t('parent.account.deleteConfirmTitle'), t('parent.account.deleteConfirmBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('parent.account.deleteAccount'),
        style: 'destructive',
        onPress: () => void performDeleteAccount(),
      },
    ]);
  }, [deleteBusy, performDeleteAccount, signOutBusy, t]);

  return (
    <ParentSubpageShell title={t('parent.account.sectionTitle')}>
      <MenuGroup titleFontFamily={dm600}>
        <MenuRow
          icon={menuIcon(UserRound)}
          label={accountEmail || '—'}
          labelFontFamily={dm500}
          showChevron={false}
        />
        <MenuRow
          bordered
          icon={menuIcon(LogOut)}
          label={t('parent.account.signOut')}
          labelFontFamily={dm500}
          destructive
          showChevron={false}
          onPress={handleSignOut}
          disabled={signOutBusy || deleteBusy}
          accessibilityLabel={t('parent.account.signOut')}
        />
        <MenuRow
          bordered
          icon={menuIcon(Trash2)}
          label={t('parent.account.deleteAccount')}
          labelFontFamily={dm500}
          destructive
          showChevron={false}
          onPress={handleDeleteAccount}
          disabled={signOutBusy || deleteBusy}
          accessibilityLabel={t('parent.account.deleteAccount')}
        />
      </MenuGroup>
    </ParentSubpageShell>
  );
}
