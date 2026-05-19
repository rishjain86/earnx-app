package com.earnx.app;

import android.app.Activity;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.JSObject;
import com.yandex.mobile.ads.common.AdRequest;
import com.yandex.mobile.ads.common.Reward;
import com.yandex.mobile.ads.rewarded.RewardedAd;
import com.yandex.mobile.ads.rewarded.RewardedAdEventListener;

@CapacitorPlugin(name = "YandexAds")
public class YandexAdsPlugin extends Plugin {

    private RewardedAd rewardedAd;

    @com.getcapacitor.PluginMethod
    public void loadRewarded(PluginCall call) {
        Activity activity = getActivity();
        rewardedAd = new RewardedAd(activity);
        rewardedAd.setAdUnitId("R-M-19301521-2");

        AdRequest adRequest = new AdRequest.Builder().build();

        rewardedAd.setRewardedAdEventListener(new RewardedAdEventListener() {
            @Override
            public void onAdLoaded() {
                rewardedAd.show();
            }

            @Override
            public void onRewarded(Reward reward) {
                JSObject ret = new JSObject();
                ret.put("success", true);
                notifyListeners("rewarded", ret);
            }

            @Override
            public void onAdFailedToLoad(com.yandex.mobile.ads.common.AdRequestError adRequestError) {}
            @Override
            public void onAdShown() {}
            @Override
            public void onAdDismissed() {}
            @Override
            public void onAdClicked() {}
            @Override
            public void onAdImpression() {}
        });

        rewardedAd.loadAd(adRequest);
        call.resolve();
    }
}
