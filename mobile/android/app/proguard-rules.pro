# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Phase 8 releaseLike evidence requires the optimized candidate to retain the
# native React bridge entrypoints. These rules do not add a second playback
# owner or widen exported Android components.
-keep class com.listen2mobile.MainApplication { *; }
-keep class com.listen2mobile.MainActivity { *; }
-keep class com.listen2mobile.**Package { *; }
-keepclassmembers class * extends com.facebook.react.bridge.ReactContextBaseJavaModule {
    <init>(...);
}
-printusage build/outputs/mapping/releaseLike/usage.txt
-printseeds build/outputs/mapping/releaseLike/seeds.txt
