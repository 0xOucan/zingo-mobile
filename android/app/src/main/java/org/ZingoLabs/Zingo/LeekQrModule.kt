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
        synchronized(lock) { session = null }
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

    /** Applies the scanned signatures, proves, stores and broadcasts; returns `{ txids }`. */
    @ReactMethod
    fun signFinish(promise: Promise) {
        settling(promise) {
            val current = synchronized(lock) { session } ?: throw IllegalStateException("no signing session")
            val zsig = synchronized(lock) { scanner?.zsig() } ?: throw IllegalStateException("the signatures are incomplete")
            val stored = try {
                val signed = io.leekwallet.zcash.sdk.applyZsig(current.prepared, current.sent, zsig)
                val proven = uniffi.zingo.pcztProve(signed)
                uniffi.zingo.pcztFinishAndStore(proven)
            } catch (e: Exception) {
                runCatching { abandon() }
                throw e
            }
            synchronized(lock) { session = null }
            saveWallet()
            val txids = JSONObject(stored).getJSONArray("txids")
            val sent = uniffi.zingo.transmitCalculated(List(txids.length()) { txids.getString(it) })
            saveWallet()
            sent
        }
    }

    /** Hands the built signing request to another link and ends the QR session. */
    internal fun takePrepared(): Pair<LeekSigner, ByteArray>? =
        synchronized(lock) { session?.also { session = null } }?.let { it.signer to it.prepared }

    private var savedBrightness: Float? = null
    private var addedKeepOn = false

    /** Sets the window to full brightness with the screen kept on, or restores both. */
    @ReactMethod
    fun brightScreen(on: Boolean, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        activity.runOnUiThread {
            val window = activity.window
            val attrs = window.attributes
            if (on) {
                if (savedBrightness == null) {
                    savedBrightness = attrs.screenBrightness
                    addedKeepOn = attrs.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON == 0
                }
                attrs.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_FULL
                window.attributes = attrs
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                savedBrightness?.let {
                    attrs.screenBrightness = it
                    window.attributes = attrs
                }
                if (addedKeepOn) {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                savedBrightness = null
                addedKeepOn = false
            }
            promise.resolve(true)
        }
    }

    /** Ends the signing session and releases the inputs it reserved. */
    @ReactMethod
    fun signAbandon(promise: Promise) {
        settling(promise) {
            if (synchronized(lock) { session } != null) {
                abandon()
            }
            ""
        }
    }
}
