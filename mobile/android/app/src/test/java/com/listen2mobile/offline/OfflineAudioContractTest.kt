package com.listen2mobile.offline
import org.junit.Assert.*
import org.junit.Test
class OfflineAudioContractTest {
 @Test fun onlyEligibleSemanticSourcesAreAccepted(){assertTrue(OfflinePolicy.accepted("netease","netrack_1"));assertTrue(OfflinePolicy.accepted("kugou","kgtrack_abcdefgh"));assertFalse(OfflinePolicy.accepted("bilibili","bitrack_x"));assertFalse(OfflinePolicy.accepted("netease","netrack_bad"))}
 @Test fun keysAreOpaqueAndStrict(){assertTrue(OfflinePolicy.validKey(OfflinePolicy.key("netease","netrack_1")));assertFalse(OfflinePolicy.validKey("../bad"))}
}
