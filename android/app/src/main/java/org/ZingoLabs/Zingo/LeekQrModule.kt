package org.ZingoLabs.Zingo

import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import io.leekwallet.zcash.sdk.QrEncoder
import io.leekwallet.zcash.sdk.QrProgress
import io.leekwallet.zcash.sdk.QrScanKind
import io.leekwallet.zcash.sdk.QrScanner
import io.leekwallet.zcash.sdk.SignerView
import org.json.JSONArray
import org.json.JSONObject

/** Signs the stored proposal with a LeekWallet board over animated QR codes, and imports the board's account the same way. */
class LeekQrModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private class Session(val signer: LeekSigner, val prepared: ByteArray, val sent: ByteArray, var encoder: QrEncoder)

    private val lock = Any()
    private var scanner: QrScanner? = null
    private var session: Session? = null
    private var proven: ByteArray? = null
    private var stored: List<String>? = null

    override fun getName(): String = "LeekQrModule"

    private fun settling(promise: Promise, call: () -> Any?) = settleLeek(promise, call)

    private fun progressJson(progress: QrProgress): String = JSONObject()
        .put("state", progress.state.name.lowercase())
        .put("received", progress.received.toLong())
        .put("total", progress.total.toLong())
        .put("percent", progress.percent.toInt())
        .put("error", progress.error ?: "")
        .toString()

    private fun saveWallet() {
        reactApplicationContext.getNativeModule(RPCModule::class.java)?.saveWalletFile()
    }

    /** Starts a scan for the board's account record (`account`) or its signatures (`zsig`). */
    @ReactMethod
    fun scanStart(kind: String, chainhint: String, promise: Promise) {
        settling(promise) {
            val scanKind = when (kind) {
                "account" -> QrScanKind.ACCOUNT_RECORD
                "zsig" -> QrScanKind.ZSIG
                else -> throw IllegalArgumentException("unknown scan kind $kind")
            }
            val network = if (scanKind == QrScanKind.ACCOUNT_RECORD) LeekSigner.network(chainhint) else null
            synchronized(lock) {
                scanner?.destroy()
                scanner = QrScanner(scanKind, network)
            }
            ""
        }
    }

    @ReactMethod
    fun scanFeed(text: String, promise: Promise) {
        settling(promise) {
            val progress = synchronized(lock) {
                (scanner ?: throw IllegalStateException("no scan in progress")).feed(text)
            }
            progressJson(progress)
        }
    }

    /** The scanned account record as JSON, seed fingerprint in hex. */
    @ReactMethod
    fun scannedAccount(promise: Promise) {
        settling(promise) {
            val record = synchronized(lock) { scanner?.accountRecord() }
                ?: throw IllegalStateException("the account record is incomplete")
            val accounts = JSONArray()
            record.accounts.forEach { entry ->
                accounts.put(
                    JSONObject()
                        .put("ufvk", entry.ufvk)
                        .put("index", entry.index.toLong())
                        .put("name", entry.name ?: "")
                        .put("birthday", entry.birthday?.toLong() ?: 0L)
                )
            }
            JSONObject()
                .put("seed_fingerprint", record.seedFingerprint.toHex())
                .put("accounts", accounts)
                .toString()
        }
    }

    private fun frameInfo(encoder: QrEncoder): String = JSONObject()
        .put("seq_len", encoder.seqLen().toLong())
        .put("longest_frame", encoder.longestFrame().toLong())
        .toString()

    private fun abandon() {
        synchronized(lock) {
            session = null
            proven = null
        }
        uniffi.zingo.pcztAbandon()
        saveWallet()
    }

    /** Builds the stored proposal's PCZT for the board and returns its animated-QR size. */
    @ReactMethod
    fun signStart(fragmentlen: Double, promise: Promise) {
        settling(promise) {
            val signer = LeekSigner.read(reactApplicationContext)
            val pczt = try {
                uniffi.zingo.pcztFromStoredProposal()
            } catch (e: Exception) {
                runCatching { uniffi.zingo.decline() }
                throw e
            }
            try {
                val prepared = io.leekwallet.zcash.sdk.prepareForSigner(pczt, signer.ufvk, signer.seedFingerprint, signer.index)
                io.leekwallet.zcash.sdk.preflight(prepared, signer.meta(), null)
                val sent = io.leekwallet.zcash.sdk.signerViewBytes(prepared, SignerView.COMPACT)
                val encoder = QrEncoder.pczt(sent, fragmentlen.toUInt())
                synchronized(lock) { session = Session(signer, prepared, sent, encoder) }
                frameInfo(encoder)
            } catch (e: Exception) {
                runCatching { abandon() }
                throw e
            }
        }
    }

    /** Encodes the same signing request with another fragment size. */
    @ReactMethod
    fun signFragment(fragmentlen: Double, promise: Promise) {
        settling(promise) {
            val current = synchronized(lock) { session } ?: throw IllegalStateException("no signing session")
            val encoder = QrEncoder.pczt(current.sent, fragmentlen.toUInt())
            synchronized(lock) { current.encoder = encoder }
            frameInfo(encoder)
        }
    }

    @ReactMethod
    fun signFrames(start: Double, count: Double, promise: Promise) {
        settling(promise) {
            val current = synchronized(lock) { session } ?: throw IllegalStateException("no signing session")
            JSONArray(current.encoder.frames(start.toULong(), count.toUInt())).toString()
        }
    }

    /** Applies the scanned signatures and proves; [broadcast] stores and sends the result. */
    @ReactMethod
    fun signProve(promise: Promise) {
        settling(promise) {
            val current = synchronized(lock) { session } ?: throw IllegalStateException("no signing session")
            val zsig = synchronized(lock) { scanner?.zsig() } ?: throw IllegalStateException("the signatures are incomplete")
            try {
                val signed = io.leekwallet.zcash.sdk.applyZsig(current.prepared, current.sent, zsig)
                hold(uniffi.zingo.pcztProve(signed))
            } catch (e: Exception) {
                runCatching { abandon() }
                throw e
            }
            ""
        }
    }

    /** Keeps the signed, proven PCZT until [broadcast] stores and sends it. */
    internal fun hold(pczt: ByteArray) {
        synchronized(lock) {
            session = null
            proven = pczt
            stored = null
        }
    }

    private fun mixnetReady(): Boolean {
        val indicator = JSONObject(uniffi.zingo.mixnetIndicator())
        return indicator.optString("mixnet_indicator") == "ready" && indicator.has("socks5_addr")
    }

    private fun store(pczt: ByteArray): List<String> {
        val txids = try {
            JSONObject(uniffi.zingo.pcztFinishAndStore(pczt)).getJSONArray("txids")
        } catch (e: Exception) {
            runCatching { abandon() }
            throw e
        }
        val ids = List(txids.length()) { txids.getString(it) }
        synchronized(lock) {
            proven = null
            stored = ids
        }
        saveWallet()
        return ids
    }

    /** Stores the held transaction once the mixnet is ready and sends it, keeping it for a retry when the send is refused; returns `{ txids }`. */
    @ReactMethod
    fun broadcast(promise: Promise) {
        settling(promise) {
            val (pczt, held) = synchronized(lock) { proven to stored }
            if (pczt == null && held == null) {
                throw IllegalStateException("no signed transaction")
            }
            if (!mixnetReady()) {
                throw LeekLinkException("LeekMixnetNotReady", "The Nym mixnet is not ready.")
            }
            val txids = held ?: store(checkNotNull(pczt))
            val sent = try {
                uniffi.zingo.transmitCalculated(txids)
            } catch (e: Exception) {
                if (e !is uniffi.zingo.ZingolibException.Mixnet && e !is uniffi.zingo.ZingolibException.Offline) {
                    synchronized(lock) { stored = null }
                    saveWallet()
                }
                throw e
            }
            synchronized(lock) { stored = null }
            saveWallet()
            sent
        }
    }

    /** Hands the built signing request to another link and ends the QR session. */
    internal fun takePrepared(): Pair<LeekSigner, ByteArray>? =
        synchronized(lock) { session?.also { session = null } }?.let { it.signer to it.prepared }

    private var savedBrightness: Float? = null
    private var addedKeepOn = false

    /** Keeps the screen on at `level` (0 to 1), or at the system brightness for a negative `level`. */
    @ReactMethod
    fun holdScreen(level: Double, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        activity.runOnUiThread {
            val window = activity.window
            val attrs = window.attributes
            if (savedBrightness == null) {
                savedBrightness = attrs.screenBrightness
                addedKeepOn = attrs.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON == 0
            }
            attrs.screenBrightness = if (level < 0) {
                WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            } else {
                level.toFloat().coerceIn(0.01f, 1f)
            }
            window.attributes = attrs
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            promise.resolve(true)
        }
    }

    /** Restores the brightness and the keep-on flag [holdScreen] changed. */
    @ReactMethod
    fun releaseScreen(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        activity.runOnUiThread {
            val window = activity.window
            savedBrightness?.let {
                val attrs = window.attributes
                attrs.screenBrightness = it
                window.attributes = attrs
            }
            if (addedKeepOn) {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            savedBrightness = null
            addedKeepOn = false
            promise.resolve(true)
        }
    }

    /** Ends the signing session and releases the inputs it reserved; answers `prepared` when a stored, unsent transaction is left. */
    @ReactMethod
    fun signAbandon(promise: Promise) {
        settling(promise) {
            val (open, left) = synchronized(lock) {
                (session != null || proven != null) to (stored != null).also { stored = null }
            }
            if (open) {
                abandon()
            }
            if (left) "prepared" else ""
        }
    }
}
