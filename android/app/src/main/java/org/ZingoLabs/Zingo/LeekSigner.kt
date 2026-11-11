package org.ZingoLabs.Zingo

import android.content.Context
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKeys
import io.leekwallet.zcash.sdk.AccountMeta
import io.leekwallet.zcash.sdk.Network
import org.json.JSONObject
import java.io.File

/** The ZIP 32 derivation of the wallet's LeekWallet account, kept beside the wallet file. */
class LeekSigner(val seedFingerprint: ByteArray, val index: UInt, val ufvk: String, val network: Network) {

    fun meta(): AccountMeta = AccountMeta(seedFingerprint, index, network, ufvk)

    companion object {
        private const val FILE_NAME = "wallet.leek.json"

        fun network(chain: String): Network = when (chain) {
            "main" -> Network.MAIN
            "test" -> Network.TEST
            else -> throw IllegalArgumentException("LeekWallet signs on mainnet and testnet only")
        }

        private fun file(context: Context): File = File(context.filesDir, FILE_NAME)

        private fun encrypted(context: Context): EncryptedFile = EncryptedFile.Builder(
            file(context),
            context,
            MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB,
        ).build()

        fun write(context: Context, signer: LeekSigner) {
            file(context).delete()
            val json = JSONObject()
                .put("seed_fingerprint", signer.seedFingerprint.toHex())
                .put("index", signer.index.toLong())
                .put("ufvk", signer.ufvk)
                .put("network", signer.network.name)
            encrypted(context).openFileOutput().use { it.write(json.toString().toByteArray()) }
        }

        fun read(context: Context): LeekSigner {
            if (!file(context).exists()) {
                throw IllegalStateException("this wallet has no LeekWallet account")
            }
            val json = JSONObject(String(encrypted(context).openFileInput().use { it.readBytes() }))
            return LeekSigner(
                seedFingerprint = json.getString("seed_fingerprint").hexToBytes(),
                index = json.getLong("index").toUInt(),
                ufvk = json.getString("ufvk"),
                network = Network.valueOf(json.getString("network")),
            )
        }

        fun delete(context: Context) {
            file(context).delete()
        }
    }
}

fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

fun String.hexToBytes(): ByteArray {
    require(length % 2 == 0) { "odd hex length" }
    return ByteArray(length / 2) { substring(2 * it, 2 * it + 2).toInt(16).toByte() }
}
