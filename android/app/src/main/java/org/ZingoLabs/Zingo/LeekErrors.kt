package org.ZingoLabs.Zingo

import com.facebook.react.bridge.Promise
import io.leekwallet.zcash.sdk.LeekException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A failure of the app's own link code (no board, no permission), shown to the user as is. */
class LeekLinkException(val code: String, message: String) : Exception(message)

/** The promise's rejection code: `Leek<code>` for the SDK, the zingolib error's name, `LeekLink…`. */
fun leekCodeOf(error: Throwable): String = when (error) {
    is LeekException.Link -> "Leek${error.code}"
    is LeekException.Session -> "Leek${error.code}"
    is LeekException.User -> "Leek${error.code}"
    is LeekException.Account -> "Leek${error.code}"
    is LeekException.Pczt -> "Leek${error.code}"
    is LeekException.Signature -> "Leek${error.code}"
    is LeekException.Storage -> "Leek${error.code}"
    is LeekException.Device -> "Leek${error.code}"
    is LeekLinkException -> error.code
    is uniffi.zingo.ZingolibException -> error.javaClass.simpleName
    else -> "Unknown"
}

/** The SDK's fixed sentence for its errors; the message otherwise. */
fun leekReasonOf(error: Throwable): String = when (error) {
    is LeekException.Link -> error.reason
    is LeekException.Session -> error.reason
    is LeekException.User -> error.reason
    is LeekException.Account -> error.reason
    is LeekException.Pczt -> error.reason
    is LeekException.Signature -> error.reason
    is LeekException.Storage -> error.reason
    is LeekException.Device -> error.reason
    else -> error.message ?: error.javaClass.simpleName
}

/** Runs [call] on the IO dispatcher and settles [promise] with its result on the main thread. */
fun settleLeek(promise: Promise, call: () -> Any?) {
    CoroutineScope(Dispatchers.IO).launch {
        val outcome = try {
            Result.success(call())
        } catch (e: Exception) {
            Result.failure(e)
        }
        withContext(Dispatchers.Main) {
            outcome.fold(
                { promise.resolve(it) },
                { promise.reject(leekCodeOf(it), leekReasonOf(it), it) },
            )
        }
    }
}
