package org.ZingoLabs.Zingo

// Adapted from LeekBleLink.kt of the LeekWallet Zodl fork
// (leekwallet-zcash, android/feature-leekwallet, MIT).

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import io.leekwallet.zcash.sdk.FrameTransport
import io.leekwallet.zcash.sdk.TransportFailure
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** The board's LeekWallet GATT service as the SDK's whole-frame link, each frame split into chunks of one header byte and at most MTU - 4 bytes. */
@SuppressLint("MissingPermission")
class LeekBleLink private constructor(
    private val gatt: BluetoothGatt,
    private val rx: BluetoothGattCharacteristic,
    private val callback: Callback,
) : FrameTransport, AutoCloseable {

    override fun send(bytes: ByteArray) {
        val capacity = (callback.mtu - 3 - 1).coerceAtLeast(1)
        var offset = 0
        var seq = 0
        while (offset < bytes.size) {
            if (callback.disconnected) throw TransportFailure.Disconnected()
            val take = minOf(capacity, bytes.size - offset)
            val more = offset + take < bytes.size
            val chunk = ByteArray(take + 1)
            chunk[0] = ((if (more) 0x80 else 0) or (seq and 0x7f)).toByte()
            System.arraycopy(bytes, offset, chunk, 1, take)
            callback.writeDone.clear()
            if (!writeChunk(chunk)) throw TransportFailure.Disconnected()
            if (callback.writeDone.poll(WRITE_TIMEOUT_S, TimeUnit.SECONDS) != true) throw TransportFailure.Disconnected()
            offset += take
            seq++
        }
    }

    @Suppress("DEPRECATION")
    private fun writeChunk(chunk: ByteArray): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeCharacteristic(rx, chunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) ==
                BluetoothStatusCodes.SUCCESS
        } else {
            rx.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            rx.value = chunk
            gatt.writeCharacteristic(rx)
        }

    override fun recv(timeoutMs: UInt): ByteArray {
        callback.frames.poll()?.let { return it }
        if (callback.disconnected) throw TransportFailure.Disconnected()
        return callback.frames.poll(timeoutMs.toLong(), TimeUnit.MILLISECONDS) ?: ByteArray(0)
    }

    override fun close() {
        gatt.disconnect()
        gatt.close()
    }

    private class Callback : BluetoothGattCallback() {
        val connected = LinkedBlockingQueue<Boolean>()
        val discovered = LinkedBlockingQueue<Boolean>()
        val mtuDone = LinkedBlockingQueue<Int>()
        val descriptorDone = LinkedBlockingQueue<Boolean>()
        val writeDone = LinkedBlockingQueue<Boolean>()
        val frames = LinkedBlockingQueue<ByteArray>()

        @Volatile var mtu = 23
        @Volatile var disconnected = false
        private val assembling = ByteArrayOutputStream()
        private var nextSeq = 0

        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            val up = status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                disconnected = true
                writeDone.offer(false)
            }
            connected.offer(up)
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            discovered.offer(status == BluetoothGatt.GATT_SUCCESS)
        }

        override fun onMtuChanged(g: BluetoothGatt, newMtu: Int, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) mtu = newMtu
            mtuDone.offer(newMtu)
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            descriptorDone.offer(status == BluetoothGatt.GATT_SUCCESS)
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            writeDone.offer(status == BluetoothGatt.GATT_SUCCESS)
        }

        @Deprecated("Android 12 and older deliver the value on the characteristic")
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) onChunk(c, c.value ?: return)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            onChunk(c, value)
        }

        private fun onChunk(c: BluetoothGattCharacteristic, chunk: ByteArray) {
            if (c.uuid != TX || chunk.isEmpty()) return
            val seq = chunk[0].toInt() and 0x7f
            val more = chunk[0].toInt() and 0x80 != 0
            if (seq != nextSeq) {
                assembling.reset()
                nextSeq = 0
                if (seq != 0) return
            }
            assembling.write(chunk, 1, chunk.size - 1)
            nextSeq = (nextSeq + 1) and 0x7f
            if (!more) {
                frames.offer(assembling.toByteArray())
                assembling.reset()
                nextSeq = 0
            }
        }
    }

    companion object {
        private val SERVICE: UUID = UUID.fromString("6c65656b-7761-6c6c-6574-000000000001")
        private val RX: UUID = UUID.fromString("6c65656b-7761-6c6c-6574-000000000002")
        private val TX: UUID = UUID.fromString("6c65656b-7761-6c6c-6574-000000000003")
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private const val WRITE_TIMEOUT_S = 5L
        private const val STEP_TIMEOUT_S = 15L
        private const val SCAN_TIMEOUT_MS = 20_000L
        private const val WANTED_MTU = 517

        private fun granted(context: Context, permission: String) =
            context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

        /** Scans for the LeekWallet service, connects to the first board found and turns on its notifications. */
        fun open(context: Context, cancelled: () -> Boolean): LeekBleLink {
            val permitted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                granted(context, Manifest.permission.BLUETOOTH_SCAN) && granted(context, Manifest.permission.BLUETOOTH_CONNECT)
            } else {
                granted(context, Manifest.permission.ACCESS_FINE_LOCATION)
            }
            if (!permitted) throw LeekLinkException("LeekBlePermission", "Bluetooth permission was not granted.")
            val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
                ?: throw LeekLinkException("LeekBleMissing", "This phone has no Bluetooth.")
            if (!adapter.isEnabled) throw LeekLinkException("LeekBleOff", "Turn Bluetooth on.")
            val scanner = adapter.bluetoothLeScanner
                ?: throw LeekLinkException("LeekBleMissing", "Bluetooth scanning is unavailable.")
            val found = LinkedBlockingQueue<BluetoothDevice>()
            val scanCallback = object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) {
                    found.offer(result.device)
                }
            }
            scanner.startScan(
                listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE)).build()),
                ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
                scanCallback,
            )
            val device = try {
                val deadline = System.currentTimeMillis() + SCAN_TIMEOUT_MS
                var hit: BluetoothDevice? = null
                while (hit == null && !cancelled() && System.currentTimeMillis() < deadline) {
                    hit = found.poll(200, TimeUnit.MILLISECONDS)
                }
                hit
            } finally {
                scanner.stopScan(scanCallback)
            } ?: throw LeekLinkException(
                "LeekBleNotFound",
                "No LeekWallet found over Bluetooth. On the board: Settings → Link → Bluetooth.",
            )

            val cb = Callback()
            val gatt = device.connectGatt(context, false, cb, BluetoothDevice.TRANSPORT_LE)
            try {
                fun step(ok: Boolean, what: String) {
                    if (!ok) throw LeekLinkException("LeekBleSetup", what)
                }
                step(cb.connected.poll(STEP_TIMEOUT_S, TimeUnit.SECONDS) == true, "The Bluetooth connection failed.")
                gatt.requestMtu(WANTED_MTU)
                cb.mtuDone.poll(STEP_TIMEOUT_S, TimeUnit.SECONDS)
                step(
                    gatt.discoverServices() && cb.discovered.poll(STEP_TIMEOUT_S, TimeUnit.SECONDS) == true,
                    "Bluetooth service discovery failed.",
                )
                val service = gatt.getService(SERVICE)
                val rx = service?.getCharacteristic(RX)
                val tx = service?.getCharacteristic(TX)
                val cccd = tx?.getDescriptor(CCCD)
                if (rx == null || tx == null || cccd == null) {
                    throw LeekLinkException("LeekBleSetup", "This Bluetooth device is not a LeekWallet.")
                }
                step(gatt.setCharacteristicNotification(tx, true), "Bluetooth notifications were refused.")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    gatt.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                } else {
                    @Suppress("DEPRECATION")
                    cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    @Suppress("DEPRECATION")
                    gatt.writeDescriptor(cccd)
                }
                step(cb.descriptorDone.poll(STEP_TIMEOUT_S, TimeUnit.SECONDS) == true, "Bluetooth notifications failed.")
                return LeekBleLink(gatt, rx, cb)
            } catch (e: Throwable) {
                gatt.close()
                throw e
            }
        }
    }
}
