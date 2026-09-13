package com.listen2mobile.offline

import android.content.*
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.ViewManager
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.*
import org.json.JSONArray
import org.json.JSONObject

private const val MAX_FILE = 128L * 1024 * 1024
private const val MAX_TOTAL = 512L * 1024 * 1024

internal object OfflinePolicy {
  private val ne = Regex("^netrack_([1-9][0-9]{0,17})$")
  private val kg = Regex("^kgtrack_([A-Za-z0-9]{8,128})$")
  fun accepted(s: String, id: String) = s == "netease" && ne.matches(id) || s == "kugou" && kg.matches(id)
  fun key(s: String, id: String) = digest("$s:$id".toByteArray())
  fun validKey(v: String?) = v?.matches(Regex("^[0-9a-f]{64}$")) == true
  fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
internal data class Entry(val operationId:String,val source:String,val trackId:String,val title:String,val artist:String,var status:String,var downloadedBytes:Long=0,var totalBytes:Long=0,var errorCode:String?=null,var updatedAt:Long=System.currentTimeMillis(),var digest:String?=null,var mimeType:String?=null)

/** All URL construction and bytes remain native-private. */
internal class OfflineCoordinator(private val root: File) {
  private val items = ConcurrentHashMap<String, Entry>(); private val futures = ConcurrentHashMap<String, Future<*>>()
  private val pool = ThreadPoolExecutor(2,2,0,TimeUnit.MILLISECONDS,ArrayBlockingQueue(8),ThreadPoolExecutor.AbortPolicy())
  init { root.mkdirs(); recover(); reconcile() }
  @Synchronized fun enqueue(s:String,id:String,title:String,artist:String):Entry {
    val key = if (OfflinePolicy.accepted(s,id)) OfflinePolicy.key(s,id) else return failed(s,id,title,artist,"INVALID_REQUEST")
    items[key]?.let{return it}; if(futures.size>=10)return failed(s,id,title,artist,"QUEUE_FULL")
    val e=Entry(UUID.randomUUID().toString(),s,id,title.take(256),artist.take(256),"queued");items[key]=e; persist()
    try { futures[key]=pool.submit { download(key,e) } } catch(_:RejectedExecutionException){e.status="failed";e.errorCode="QUEUE_FULL"};return e
  }
  @Synchronized fun cancel(op:String){ items.entries.firstOrNull{it.value.operationId==op}?.let{(k,e)->futures.remove(k)?.cancel(true);File(root,"$k.${e.operationId}.part").delete();e.status="cancelled";e.errorCode="CANCELLED";e.updatedAt=System.currentTimeMillis();persist()} }
  @Synchronized fun remove(s:String,id:String){ val k=OfflinePolicy.key(s,id);futures.remove(k)?.cancel(true);items.remove(k);File(root,k).delete();persist() }
  @Synchronized fun clear(){items.values.toList().forEach{remove(it.source,it.trackId)}}
  fun snapshot()=items.values.sortedByDescending{it.updatedAt}.toList()
  fun resolve(s:String,id:String):Entry? { reconcile();val k=OfflinePolicy.key(s,id);val e=items[k]?:return null;val f=File(root,k);if(e.status!="ready"||!f.isFile||f.length()!=e.downloadedBytes||sha(f)!=e.digest){remove(s,id);return null};return e }
  fun file(k:String)=if(OfflinePolicy.validKey(k)) items[k]?.let{ if(it.status=="ready"&&sha(File(root,k))==it.digest) File(root,k) else null } else null
  private fun download(key:String,e:Entry){
    try { e.status="downloading";val media=mediaUrl(e)?:throw IOException("ROUTE_UNAVAILABLE");val conn=open(media);val type=conn.contentType?.substringBefore(';')?:"";val length=conn.contentLengthLong;if(!type.startsWith("audio/")||length>MAX_FILE||used()+maxOf(0,length)>MAX_TOTAL)throw IOException(if(length>MAX_FILE)"FILE_TOO_LARGE" else "QUOTA_EXCEEDED")
      val part=File(root,"$key.${e.operationId}.part");conn.inputStream.use{input->FileOutputStream(part).use{out->val b=ByteArray(8192);var n:Int;var count=0L;while(input.read(b).also{n=it}>0){if(Thread.interrupted())throw InterruptedIOException();count+=n;if(count>MAX_FILE||used()+count>MAX_TOTAL)throw IOException("FILE_TOO_LARGE");out.write(b,0,n);e.downloadedBytes=count;e.totalBytes=if(length>0)length else count};out.fd.sync()}}
      if(!signature(part))throw IOException("INVALID_MEDIA");val final=File(root,key);if(!part.renameTo(final))throw IOException("COMMIT_FAILED");e.digest=sha(final);e.mimeType=type;e.status="ready";e.totalBytes=final.length();e.downloadedBytes=final.length();e.errorCode=null
    } catch(x:Exception){File(root,"$key.${e.operationId}.part").delete();e.status=if(x is InterruptedIOException)"cancelled" else "failed";e.errorCode=if(x is InterruptedIOException)"CANCELLED" else safeCode(x.message)} finally {e.updatedAt=System.currentTimeMillis();futures.remove(key)}
  }
  @Synchronized fun retry(s:String,id:String):Entry? { val old=items[OfflinePolicy.key(s,id)]?:return null;remove(s,id);return enqueue(old.source,old.trackId,old.title,old.artist) }
  private fun mediaUrl(e:Entry):String?=when(e.source){"netease"->"https://music.163.com/song/media/outer/url?id=${e.trackId.removePrefix("netrack_")}.mp3";"kugou"->kugouUrl(e.trackId.removePrefix("kgtrack_"));else->null}
  private fun kugouUrl(hash:String):String? { val c=open("https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=$hash");val raw=c.inputStream.use{String(it.readBytes().take(65537).toByteArray())};if(raw.length>65536)return null;val hit=Regex("\\\"play_url\\\"\\s*:\\s*\\\"(https://[^\\\"]+)\\\"").find(raw)?.groupValues?.get(1)?:return null;return try{val u=URL(hit);if(u.protocol=="https"&&u.host=="sharefs.kugou.com")u.toString()else null}catch(_:Exception){null} }
  private fun open(raw:String):HttpURLConnection { var url=URL(raw);repeat(3){val c=(url.openConnection() as HttpURLConnection).apply{instanceFollowRedirects=false;connectTimeout=15000;readTimeout=30000;requestMethod="GET"};val code=c.responseCode;if(code in 300..399){val next=c.getHeaderField("Location")?:throw IOException("REDIRECT_REJECTED");url=URL(url,next);if(url.protocol!="https")throw IOException("REDIRECT_REJECTED")}else {if(code==401||code==403)throw IOException("ENTITLEMENT");if(code !in 200..299)throw IOException("HTTP_FAILED");return c}};throw IOException("REDIRECT_REJECTED") }
  private fun used()=items.values.filter{it.status=="ready"}.sumOf{it.downloadedBytes}
  private fun sha(f:File)=FileInputStream(f).use{input->val md=MessageDigest.getInstance("SHA-256");val b=ByteArray(8192);while(true){val n=input.read(b);if(n<0)break;md.update(b,0,n)};md.digest().joinToString(""){"%02x".format(it)}}
  private fun signature(f:File)=FileInputStream(f).use{val b=ByteArray(12);val n=it.read(b);n>=4&&(String(b,0,3)=="ID3"||(b[0].toInt()and 255)==255||String(b,0,4)=="fLaC"||String(b,0,4)=="OggS"||String(b,4,4)=="ftyp")}
  private fun failed(s:String,id:String,t:String,a:String,c:String)=Entry(UUID.randomUUID().toString(),s,id,t.take(256),a.take(256),"failed",errorCode=c)
  private fun safeCode(v:String?)=when(v){"ROUTE_UNAVAILABLE","FILE_TOO_LARGE","QUOTA_EXCEEDED","ENTITLEMENT","INVALID_MEDIA","REDIRECT_REJECTED"->v;else->"DOWNLOAD_FAILED"}
  private fun persist(){val a=JSONArray();items.forEach{(k,e)->a.put(JSONObject().put("k",k).put("o",e.operationId).put("s",e.source).put("i",e.trackId).put("t",e.title).put("a",e.artist).put("z",e.status).put("b",e.downloadedBytes).put("n",e.totalBytes).put("e",e.errorCode).put("u",e.updatedAt).put("d",e.digest).put("m",e.mimeType))};val tmp=File(root,"catalog.tmp");val main=File(root,"catalog.json");val previous=File(root,"catalog.previous.json");FileOutputStream(tmp).use{it.write(JSONObject().put("version",1).put("entries",a).toString().toByteArray());it.fd.sync()};if(main.exists())main.copyTo(previous,true);tmp.renameTo(main)}
  private fun recover(){val f=File(root,"catalog.json").takeIf{it.isFile}?:File(root,"catalog.previous.json");if(!f.isFile)return;try{val a=JSONObject(f.readText()).getJSONArray("entries");for(x in 0 until a.length()){val o=a.getJSONObject(x);items[o.getString("k")]=Entry(o.getString("o"),o.getString("s"),o.getString("i"),o.getString("t"),o.getString("a"),o.getString("z"),o.getLong("b"),o.getLong("n"),if(o.isNull("e"))null else o.getString("e"),o.getLong("u"),if(o.isNull("d"))null else o.getString("d"),if(o.isNull("m"))null else o.getString("m"))}}catch(_:Exception){f.delete()}}
  private fun reconcile(){root.listFiles()?.filter{it.name.endsWith(".part")||it.name.endsWith(".tmp")}.orEmpty().forEach{it.delete()};items.entries.toList().forEach{(k,e)->if(e.status=="ready"&&file(k)==null)items.remove(k)};persist()}
}
internal object OfflineRegistry { @Volatile private var value:OfflineCoordinator?=null;fun get(c:Context)=value?:synchronized(this){value?:OfflineCoordinator(File(c.noBackupFilesDir,"offline-media-01")).also{value=it}} }

@ReactModule(name=OfflineAudioModule.NAME) class OfflineAudioModule(private val app:ReactApplicationContext):ReactContextBaseJavaModule(app){
  companion object{const val NAME="Listen2OfflineAudio"};override fun getName()=NAME;private fun c()=OfflineRegistry.get(app)
  @ReactMethod fun listDownloads(p:Promise)=p.resolve(snapshot())
  @ReactMethod fun enqueueDownload(m:ReadableMap,p:Promise){val allowed=setOf("source","trackId","title","artist","album","durationMs");val it=m.keySetIterator();while(it.hasNextKey())if(!allowed.contains(it.nextKey())){p.resolve(snapshot());return};c().enqueue(m.getString("source")?:"",m.getString("trackId")?:"",m.getString("title")?:"未知歌曲",m.getString("artist")?:"未知艺人");emit();p.resolve(snapshot())}
  @ReactMethod fun cancelDownload(op:String,p:Promise){c().cancel(op);emit();p.resolve(snapshot())};@ReactMethod fun retryDownload(s:String,id:String,p:Promise){c().retry(s,id);emit();p.resolve(snapshot())};@ReactMethod fun removeDownload(s:String,id:String,p:Promise){c().remove(s,id);emit();p.resolve(snapshot())};@ReactMethod fun clearDownloads(p:Promise){c().clear();emit();p.resolve(snapshot())};@ReactMethod fun invalidate(s:String,id:String,p:Promise){c().remove(s,id);emit();p.resolve(snapshot())}
  @ReactMethod fun resolveVerified(s:String,id:String,p:Promise){val e=c().resolve(s,id);if(e==null){p.resolve(code("miss"));return};p.resolve(Arguments.createMap().apply{putString("status","hit");putString("uri","content://${app.packageName}.offline-cache/${OfflinePolicy.key(s,id)}");putString("mimeType",e.mimeType)})}
  @ReactMethod fun addListener(event:String){};@ReactMethod fun removeListeners(n:Int){}
  private fun emit(){app.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("catalogChanged",snapshot())}
  private fun snapshot()=Arguments.createMap().apply{putDouble("usedBytes",c().snapshot().filter{it.status=="ready"}.sumOf{it.downloadedBytes}.toDouble());putDouble("quotaBytes",MAX_TOTAL.toDouble());putArray("entries",Arguments.fromList(c().snapshot().map{entry(it)}))}
  private fun entry(e:Entry)=Arguments.createMap().apply{putString("operationId",e.operationId);putString("source",e.source);putString("trackId",e.trackId);putString("title",e.title);putString("artist",e.artist);putString("status",e.status);putDouble("downloadedBytes",e.downloadedBytes.toDouble());putDouble("totalBytes",e.totalBytes.toDouble());putString("errorCode",e.errorCode);putDouble("updatedAt",e.updatedAt.toDouble())};private fun code(v:String)=Arguments.createMap().apply{putString("status",v)} }
class OfflineAudioPackage:ReactPackage{override fun createNativeModules(c:ReactApplicationContext)=listOf(OfflineAudioModule(c));override fun createViewManagers(c:ReactApplicationContext):List<ViewManager<*,*>> = emptyList()}
class OfflineAudioProvider:ContentProvider(){override fun onCreate()=true;override fun openFile(uri:Uri,mode:String):ParcelFileDescriptor{if(mode!="r"||uri.pathSegments.size!=1)throw FileNotFoundException("not-found");val file=OfflineRegistry.get(requireNotNull(context)).file(uri.lastPathSegment)?:throw FileNotFoundException("not-found");return ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY)};override fun getType(uri:Uri):String?=null;override fun query(uri:Uri,p:Array<out String>?,s:String?,a:Array<out String>?,o:String?):Cursor?=null;override fun insert(uri:Uri,v:ContentValues?):Uri?=null;override fun delete(uri:Uri,s:String?,a:Array<out String>?)=0;override fun update(uri:Uri,v:ContentValues?,s:String?,a:Array<out String>?)=0}
