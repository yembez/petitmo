import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { PETITMO_LOGO_MANUSCRIT_XML } from '@/components/petitmoLogoManuscritXml';

/** Aligné sur le viewBox du fichier SVG (évite bandes vides si width/height respectent ce ratio) */
export const PETITMO_LOGO_VIEWBOX = { x: 0, y: 0, width: 319.62595, height: 181.79358 } as const;

type Props = {
  width: number;
  height: number;
  /** Par défaut : encre type interface (#1C1C1E) */
  color?: string;
  /** Halo noir omnidirectionnel très doux (contraste sur photo sans « tache » visible) */
  shadow?: boolean;
};

function tintSvg(xml: string, fill: string): string {
  // Le SVG source utilise `fill:#fefbfd` (blanc cassé). On le remplace par la couleur demandée.
  return xml
    .replace(/fill:\s*#fefbfd/gi, `fill:${fill}`)
    .replace(/fill=\"\s*#fefbfd\s*\"/gi, `fill="${fill}"`);
}

/**
 * Logo manuscrit vectoriel (Inkscape / Figma export paths).
 * viewBox rogné autour du mot pour éviter la page A4 vide du fichier source.
 */
export default function PetitmoLogoManuscrit({
  width,
  height,
  color = '#1C1C1E',
  shadow = false,
}: Props) {
  const xml = useMemo(() => tintSvg(PETITMO_LOGO_MANUSCRIT_XML, color), [color]);
  const shadowXml = useMemo(() => tintSvg(PETITMO_LOGO_MANUSCRIT_XML, '#000000'), []);

  return (
    <View style={[styles.wrap, { width, height }]}>
      {shadow ? (
        <>
          <View style={[StyleSheet.absoluteFillObject, { opacity: 0.14, transform: [{ translateY: 1 }] }]}>
            <SvgXml xml={shadowXml} width={width} height={height} />
          </View>
          <View style={[StyleSheet.absoluteFillObject, { opacity: 0.09, transform: [{ translateY: 2 }] }]}>
            <SvgXml xml={shadowXml} width={width} height={height} />
          </View>
        </>
      ) : null}
      <SvgXml xml={xml} width={width} height={height} />
    </View>
  );
}

/**
 * Variante “tight” : rogne le vide horizontal autour du logo à l'affichage.
 * Important : le composant original n'est pas modifié, donc aucun autre écran n'est impacté.
 */
export function PetitmoLogoManuscritTight({
  width,
  height,
  color = '#1C1C1E',
  shadow = false,
}: Props) {
  // Approximation basée sur le rendu UI : on garde ~83% de la largeur pour supprimer le vide.
  const TIGHT_WIDTH_RATIO = 0.83;
  const tightWidth = Math.max(1, Math.round(width * TIGHT_WIDTH_RATIO));

  const xml = useMemo(() => tintSvg(PETITMO_LOGO_MANUSCRIT_XML, color), [color]);
  const shadowXml = useMemo(() => tintSvg(PETITMO_LOGO_MANUSCRIT_XML, '#000000'), []);

  // Décalage horizontal pour centrer visuellement le tracé dans la zone rognée.
  const leftOffset = -Math.round(width * 0.09);

  return (
    <View style={{ width: tightWidth, height, overflow: 'hidden' }}>
      {shadow ? (
        <>
          <View
            style={[
              StyleSheet.absoluteFillObject,
              { opacity: 0.14, transform: [{ translateX: leftOffset }, { translateY: 1 }] },
            ]}
          >
            <SvgXml xml={shadowXml} width={width} height={height} />
          </View>
          <View
            style={[
              StyleSheet.absoluteFillObject,
              { opacity: 0.09, transform: [{ translateX: leftOffset }, { translateY: 2 }] },
            ]}
          >
            <SvgXml xml={shadowXml} width={width} height={height} />
          </View>
        </>
      ) : null}
      <View style={{ marginLeft: leftOffset }}>
        <SvgXml xml={xml} width={width} height={height} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
