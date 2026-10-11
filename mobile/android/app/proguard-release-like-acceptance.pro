# releaseLike-only test observability through the existing RNTP public binder.
# Keep these members callable, while permitting normal class/member renaming.
# No player mutation, reflection, arbitrary bridge, or vendor-wide keep rule.
-keepclassmembers,allowobfuscation class com.doublesymmetry.trackplayer.service.MusicService$MusicBinder {
    public com.doublesymmetry.trackplayer.service.MusicService getService();
}
-keepclassmembers,allowobfuscation class com.doublesymmetry.trackplayer.service.MusicService {
    public double getPositionInSeconds();
}
