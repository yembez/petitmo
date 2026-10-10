import { FileText, Shield } from 'lucide-react-native';
import ParentSubpageShell from '@/components/parentSpace/ParentSubpageShell';
import { MenuGroup, MenuRow, menuIcon, openUrl } from '@/components/parentSpace/menuUi';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import {
  LEGAL_MENTIONS_URL,
  LEGAL_PRIVACY_URL,
  LEGAL_TERMS_URL,
} from '@/lib/legalUrls';

export default function ParentLegalScreen() {
  const { dm500, dm600 } = useDmSansFamilyFlowFonts();

  return (
    <ParentSubpageShell title="Informations légales">
      <MenuGroup titleFontFamily={dm600}>
        <MenuRow
          icon={menuIcon(Shield)}
          label="Politique de confidentialité"
          labelFontFamily={dm500}
          onPress={() => void openUrl(LEGAL_PRIVACY_URL)}
        />
        <MenuRow
          bordered
          icon={menuIcon(FileText)}
          label="Conditions d'utilisation"
          labelFontFamily={dm500}
          onPress={() => void openUrl(LEGAL_TERMS_URL)}
        />
        <MenuRow
          bordered
          icon={menuIcon(FileText)}
          label="Mentions légales"
          labelFontFamily={dm500}
          onPress={() => void openUrl(LEGAL_MENTIONS_URL)}
        />
      </MenuGroup>
    </ParentSubpageShell>
  );
}
