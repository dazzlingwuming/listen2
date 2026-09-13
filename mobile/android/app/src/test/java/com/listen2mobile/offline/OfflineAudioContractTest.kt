package com.listen2mobile.offline
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
class OfflineAudioContractTest {
 @Test fun onlyEligibleSemanticSourcesAreAccepted(){assertTrue(OfflinePolicy.accepted("netease","netrack_1"));assertTrue(OfflinePolicy.accepted("kugou","kgtrack_abcdefgh"));assertFalse(OfflinePolicy.accepted("bilibili","bitrack_x"));assertFalse(OfflinePolicy.accepted("netease","netrack_bad"))}
 @Test fun keysAreOpaqueAndStrict(){assertTrue(OfflinePolicy.validKey(OfflinePolicy.key("netease","netrack_1")));assertFalse(OfflinePolicy.validKey("../bad"))}
 @Test fun duplicateRequestsConvergeAndEleventhIsRejected(){val c=OfflineCoordinator(Files.createTempDirectory("offline").toFile());val one=c.enqueue("netease","netrack_1","t","a");assertEquals(one.operationId,c.enqueue("netease","netrack_1","t","a").operationId);for(i in 2..10)c.enqueue("netease","netrack_$i","t","a");assertEquals("QUEUE_FULL",c.enqueue("netease","netrack_11","t","a").errorCode)}
 @Test fun partialArtifactsAreNeverCatalogMedia(){val root=Files.createTempDirectory("offline").toFile();File(root,"orphan.part").writeText("partial");OfflineCoordinator(root);assertFalse(File(root,"orphan.part").exists())}
}
