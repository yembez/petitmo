import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import { VideoView, type VideoContentFit, type VideoPlayer } from 'expo-video';

/**
 * `VideoView` Petitmo : pas de contrôles natifs, `textureView` sur Android pour
 * éviter le débordement connu quand deux vues `cover` se chevauchent.
 */
export function PetitmoVideoView({
  player,
  contentFit = 'cover',
  style,
  nativeControls = false,
  onFirstFrameRender,
}: {
  player: VideoPlayer;
  contentFit?: VideoContentFit;
  style?: StyleProp<ViewStyle>;
  nativeControls?: boolean;
  onFirstFrameRender?: () => void;
}) {
  return (
    <VideoView
      player={player}
      style={style}
      contentFit={contentFit}
      nativeControls={nativeControls}
      surfaceType={Platform.OS === 'android' ? 'textureView' : undefined}
      onFirstFrameRender={onFirstFrameRender}
    />
  );
}
