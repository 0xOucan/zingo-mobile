package org.ZingoLabs.Zingo

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import io.leekwallet.zcash.sdk.LeekDevice
import io.leekwallet.zcash.sdk.LinkKind
import io.leekwallet.zcash.sdk.PairingListener
import io.leekwallet.zcash.sdk.SignListener
import io.leekwallet.zcash.sdk.SignProgress
import io.leekwallet.zcash.sdk.SignerView
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/** Imports the board's account and signs the stored proposal with a LeekWallet board over USB or Bluetooth LE, pairing afresh on every connection. */
class LeekLinkModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private class Link(val device: LeekDevice, val transport: AutoCloseable)

    private val lock = Any()
    private var link: Link? = null
    private val busy = AtomicBoolean(false)
    private val cancelled = AtomicBoolean(false)

    @Volatile private var status = JSONObject().put("stage", "idle")

    override fun getName(): String = "LeekLinkModule"

    private fun stage(name: String, extra: (JSONObject) -> Unit = {}) {
        status = JSONObject().put("stage", name).also(extra)
    }

    private fun saveWallet() {
        reactApplicationContext.getNativeModule(RPCModule::class.java)?.saveWalletFile()
    }

    private fun closeLink() {
        val current = synchronized(lock) { link.also { link = null } } ?: return
        runCatching { current.device.close() }
        runCatching { current.transport.close() }
    }

    private fun <T> exclusive(call: () -> T): T {
        if (!busy.compareAndSet(false, true)) {
            throw LeekLinkException("LeekLinkBusy", "The board is busy with another request.")
        }
        try {
            return call()
        } finally {
            busy.set(false)
        }
    }

    private fun connected(): Link =
        synchronized(lock) { link } ?: throw LeekLinkException("LeekLinkClosed", "The board is not connected.")

    /** Opens the link (`usb` or `ble`), pairs with a new six-digit code and waits for the board to be unlocked. */
    @ReactMethod
    fun connect(kind: String, promise: Promise) {
        settleLeek(promise) {
            exclusive {
                closeLink()
                cancelled.set(false)
                stage("connecting")
                val transport = when (kind) {
                    "usb" -> LeekUsbLink.open(reactApplicationContext) { cancelled.get() }
                    "ble" -> LeekBleLink.open(reactApplicationContext) { cancelled.get() }
                    else -> throw IllegalArgumentException("unknown link $kind")
                }
                val device = LeekDevice(transport, if (kind == "usb") LinkKind.STREAM else LinkKind.FRAMES)
                synchronized(lock) { link = Link(device, transport) }
                try {
                    if (cancelled.get()) throw LeekLinkException("LeekLinkCancelled", "Cancelled.")
                    device.pair(object : PairingListener {
                        override fun onPairingCode(code: String) {
                            stage("pair") { it.put("code", code) }
                        }
                    })
                    stage("unlock")
                    device.ensureUnlocked()
                    val update = runCatching { device.getFeatures() }.getOrNull()
                        ?.takeIf { it.firmwareOutdated }
                        ?.let { io.leekwallet.zcash.sdk.boardUpdateText() } ?: ""
                    stage("connected") { it.put("update", update) }
                    JSONObject().put("update", update).toString()
                } catch (e: Exception) {
                    closeLink()
                    stage("idle")
                    throw e
                }
            }
        }
    }

    /** Reads account 0's viewing key after "Share view key?" is answered on the board, then closes the link. */
    @ReactMethod
    fun getAccount(chainhint: String, promise: Promise) {
        settleLeek(promise) {
            exclusive {
                try {
                    val network = LeekSigner.network(chainhint)
                    stage("share")
                    val account = connected().device.getAccount(0u, network)
                    JSONObject()
                        .put("seed_fingerprint", account.seedFingerprint.toHex())
                        .put("index", account.index.toLong())
                        .put("ufvk", account.ufvk)
                        .put("ua", account.ua)
                        .put("birthday", account.birthday?.toLong() ?: 0L)
                        .toString()
                } finally {
                    closeLink()
                    stage("idle")
                }
            }
        }
    }

    private fun abandon() {
        uniffi.zingo.pcztAbandon()
        saveWallet()
    }

    private fun prepared(): Pair<LeekSigner, ByteArray> {
        reactApplicationContext.getNativeModule(LeekQrModule::class.java)?.takePrepared()?.let { return it }
        val signer = LeekSigner.read(reactApplicationContext)
        stage("building")
        val pczt = try {
            uniffi.zingo.pcztFromStoredProposal()
        } catch (e: Exception) {
            runCatching { uniffi.zingo.decline() }
            throw e
        }
        return try {
            signer to io.leekwallet.zcash.sdk.prepareForSigner(pczt, signer.ufvk, signer.seedFingerprint, signer.index)
        } catch (e: Exception) {
            runCatching { abandon() }
            throw e
        }
    }

    /** Signs the stored proposal on the connected board, then proves, stores and broadcasts it; returns `{ txids }`. */
    @ReactMethod
    fun sign(promise: Promise) {
        settleLeek(promise) {
            exclusive {
                try {
                    val device = connected().device
                    val (signer, pczt) = prepared()
                    val stored = try {
                        if (cancelled.get()) throw LeekLinkException("LeekLinkCancelled", "Cancelled.")
                        val signed = device.signPczt(pczt, signer.meta(), SignerView.COMPACT, true, object : SignListener {
                            override fun onProgress(progress: SignProgress) {
                                when (progress) {
                                    is SignProgress.Checking -> stage("checking")
                                    is SignProgress.Uploading -> stage("uploading") {
                                        it.put("sent", progress.sent.toLong()).put("total", progress.total.toLong())
                                    }
                                    is SignProgress.ReviewOnDevice -> stage("review")
                                    is SignProgress.Applying -> stage("applying")
                                }
                            }
                        })
                        closeLink()
                        stage("proving")
                        uniffi.zingo.pcztFinishAndStore(uniffi.zingo.pcztProve(signed.signedPczt))
                    } catch (e: Exception) {
                        runCatching { abandon() }
                        throw e
                    }
                    saveWallet()
                    stage("sending")
                    val txids = JSONObject(stored).getJSONArray("txids")
                    val sent = uniffi.zingo.transmitCalculated(List(txids.length()) { txids.getString(it) })
                    saveWallet()
                    sent
                } finally {
                    closeLink()
                    stage("idle")
                }
            }
        }
    }

    /** The current step as JSON: `stage`, and `code`, `sent`/`total` or `update` where they apply. */
    @ReactMethod
    fun status(promise: Promise) {
        promise.resolve(status.toString())
    }

    /** Stops the running board call and closes the link once it ends. */
    @ReactMethod
    fun cancel(promise: Promise) {
        cancelled.set(true)
        synchronized(lock) { link }?.device?.cancel()
        if (!busy.get()) {
            closeLink()
            stage("idle")
        }
        promise.resolve("")
    }
}
