import { useState } from 'react';
import { HelpCircle, MessageCircle } from 'lucide-react-native';
import ParentSubpageShell from '@/components/parentSpace/ParentSubpageShell';
import { MenuGroup, MenuRow, menuIcon } from '@/components/parentSpace/menuUi';
import SupportContactModal from '@/components/SupportContactModal';
import type { SupportMessageKind } from '@/services/supportContact';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { peekRealAuthEmail } from '@/lib/authAccount';

export default function ParentHelpScreen() {
  const { t } = useAppTranslation('common');
  const { dm500, dm600 } = useDmSansFamilyFlowFonts();
  const [supportKind, setSupportKind] = useState<SupportMessageKind | null>(null);
  const accountEmail = peekRealAuthEmail() || '';

  return (
    <ParentSubpageShell title="Aide">
      <MenuGroup titleFontFamily={dm600}>
        <MenuRow
          icon={menuIcon(HelpCircle)}
          label={t('parent.report.cta')}
          labelFontFamily={dm500}
          onPress={() => setSupportKind('report')}
          accessibilityLabel={t('parent.report.cta')}
        />
        <MenuRow
          bordered
          icon={menuIcon(MessageCircle)}
          label={t('parent.support.contactCta')}
          labelFontFamily={dm500}
          onPress={() => setSupportKind('contact')}
          accessibilityLabel={t('parent.support.contactCta')}
        />
      </MenuGroup>
      <SupportContactModal
        visible={supportKind != null}
        kind={supportKind ?? 'contact'}
        defaultEmail={accountEmail}
        onClose={() => setSupportKind(null)}
      />
    </ParentSubpageShell>
  );
}
