/**
 * Partage d’un fichier PDF déjà généré (ex. téléchargement après `generateBookPdfViaServer`).
 * La **génération** PDF livre se fait exclusivement côté serveur — voir `bookPdfServer.ts` et AGENTS.md.
 */
import * as Sharing from 'expo-sharing';

export async function shareBookPdf(pdfUri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Le partage n'est pas disponible sur cet appareil.");
  }
  await Sharing.shareAsync(pdfUri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
  });
}
