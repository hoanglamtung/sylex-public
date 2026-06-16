import { Platform } from 'react-native';
import mobileAds, {
  AdEventType,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

const PROD_REWARDED_UNIT_ID_ANDROID = 'ca-app-pub-4934175729303466/5547139058';
const PROD_REWARDED_UNIT_ID_IOS = 'ca-app-pub-4934175729303466/3628598906';

let initPromise: Promise<void> | null = null;

function getRewardedUnitId(): string {
  if (__DEV__) {
    return TestIds.REWARDED;
  }

  const id = Platform.select({
    ios: PROD_REWARDED_UNIT_ID_IOS,
    android: PROD_REWARDED_UNIT_ID_ANDROID,
    default: '',
  });

  if (!id || id.includes('xxxxxxxx')) {
    throw new Error('AdMob rewarded unit id is not configured for this build.');
  }

  return id;
}

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = mobileAds()
      .initialize()
      .then(() => undefined);
  }

  await initPromise;
}

export type RewardedAdResult = {
  rewarded: boolean;
  rewardAmount: number;
  rewardType: string;
};

export async function showRewardedAd(): Promise<RewardedAdResult> {
  await ensureInitialized();
  const unitId = getRewardedUnitId();
  console.log('[AdMob] Rewarded load requested', { unitId, platform: Platform.OS, dev: __DEV__ });

  // Defensive guard: if enum wiring is stale/mismatched, force rewarded-loaded token.
  const rewardedLoadedEvent =
    RewardedAdEventType.LOADED === AdEventType.LOADED
      ? ('rewarded_loaded' as unknown as RewardedAdEventType)
      : RewardedAdEventType.LOADED;

  const ad = RewardedAd.createForAdRequest(unitId, {
    requestNonPersonalizedAdsOnly: true,
  });

  return new Promise<RewardedAdResult>((resolve, reject) => {
    let didResolve = false;
    let rewarded = false;
    let rewardAmount = 0;
    let rewardType = '';

    const cleanup = () => {
      unsubscribeLoaded();
      unsubscribeOpened();
      unsubscribeReward();
      unsubscribeClosed();
      unsubscribeError();
    };

    const safeResolve = (result: RewardedAdResult) => {
      if (didResolve) return;
      didResolve = true;
      cleanup();
      resolve(result);
    };

    const safeReject = (error: Error) => {
      if (didResolve) return;
      didResolve = true;
      cleanup();
      reject(error);
    };

    const unsubscribeLoaded = ad.addAdEventListener(rewardedLoadedEvent, () => {
      console.log('[AdMob] Rewarded loaded');
      ad.show().catch(() => {
        console.warn('[AdMob] Rewarded show failed');
        safeReject(new Error('Unable to show rewarded ad.'));
      });
    });

    const unsubscribeOpened = ad.addAdEventListener(AdEventType.OPENED, () => {
      console.log('[AdMob] Rewarded opened');
    });

    const unsubscribeReward = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward) => {
      rewarded = true;
      rewardAmount = reward?.amount ?? 0;
      rewardType = reward?.type ?? '';
      console.log('[AdMob] Reward earned', { rewardAmount, rewardType });
    });

    const unsubscribeClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      console.log('[AdMob] Rewarded closed', { rewarded, rewardAmount, rewardType });
      safeResolve({ rewarded, rewardAmount, rewardType });
    });

    const unsubscribeError = ad.addAdEventListener(AdEventType.ERROR, (error) => {
      console.warn('[AdMob] Rewarded failed', error);
      safeReject(new Error('Rewarded ad failed to load.'));
    });

    console.log('[AdMob] Rewarded load start');
    ad.load();
  });
}
