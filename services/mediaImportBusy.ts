/**
 * Gate silencieux : pendant un import / capture en cours, ne pas lancer le flush
 * cloud au boot / foreground (évite de ressentir la sync pendant que l’UI peigne).
 */
let mediaImportBusyDepth = 0;

export function beginMediaImportBusy(): void {
  mediaImportBusyDepth += 1;
}

export function endMediaImportBusy(): void {
  mediaImportBusyDepth = Math.max(0, mediaImportBusyDepth - 1);
}

export function isMediaImportBusy(): boolean {
  return mediaImportBusyDepth > 0;
}
