-- Ajout des métadonnées de détection de visage sur le profil enfant.
-- Ces 4 valeurs normalisées (0-1) permettent à ChildAvatar de zoomer/centrer
-- automatiquement le visage dans l'avatar rond sur n'importe quel appareil.
-- Elles sont calculées on-device (expo-face-detector) puis sauvegardées ici
-- pour récupération immédiate lors d'une reconnexion sur un nouvel appareil.

ALTER TABLE children ADD COLUMN IF NOT EXISTS face_cx         FLOAT DEFAULT NULL;
ALTER TABLE children ADD COLUMN IF NOT EXISTS face_cy         FLOAT DEFAULT NULL;
ALTER TABLE children ADD COLUMN IF NOT EXISTS face_h          FLOAT DEFAULT NULL;
ALTER TABLE children ADD COLUMN IF NOT EXISTS face_img_aspect FLOAT DEFAULT NULL;
