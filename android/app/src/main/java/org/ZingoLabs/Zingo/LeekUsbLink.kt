package org.ZingoLabs.Zingo

// Adapted from UsbSerialIo.kt and LeekWalletDevice.kt of the LeekWallet Zodl fork
// (leekwallet-zcash, android/feature-leekwallet, MIT).

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import androidx.core.content.ContextCompat
import io.leekwallet.zcash.sdk.FrameTransport
import io.leekwallet.zcash.sdk.TransportFailure
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** The board's ESP32-S3 USB Serial/JTAG port as the SDK's byte stream, with DTR/RTS left alone because they reset the chip. */
class LeekUsbLink private constructor(
    private val manager: UsbManager,
    private val device: UsbDevice,
    private val connection: UsbDeviceConnection,
    private val dataInterface: UsbInterface,
    private val inEp: UsbEndpoint,
    private val outEp: UsbEndpoint,
) : FrameTransport, AutoCloseable {
    private val buffer = ByteArray(inEp.maxPacketSize.coerceAtLeast(64) * 8)
    private val closed = AtomicBoolean(false)

    override fun send(bytes: ByteArray) {
        var off = 0
        while (off < bytes.size) {
            if (closed.get()) throw TransportFailure.Disconnected()
            val n = connection.bulkTransfer(outEp, bytes, off, bytes.size - off, WRITE_TIMEOUT_MS)
            if (n <= 0) throw TransportFailure.Disconnected()
            off += n
        }
    }

    override fun recv(timeoutMs: UInt): ByteArray {
        if (closed.get()) throw TransportFailure.Disconnected()
        val n = connection.bulkTransfer(inEp, buffer, buffer.size, timeoutMs.toInt().coerceAtLeast(1))
        if (n > 0) return buffer.copyOf(n)
        if (!manager.deviceList.containsKey(device.deviceName)) throw TransportFailure.Disconnected()
        return ByteArray(0)
    }

    override fun close() {
        if (closed.getAndSet(true)) return
        connection.releaseInterface(dataInterface)
        connection.close()
    }

    companion object {
        private const val WRITE_TIMEOUT_MS = 2000
        private const val PERMISSION_TIMEOUT_MS = 60_000L
        private const val ACTION_USB_PERMISSION = "org.ZingoLabs.Zingo.LEEK_USB_PERMISSION"

        /** Espressif's USB vendor ID, the ESP32-S3's built-in USB Serial/JTAG. */
        const val ESPRESSIF_VID = 0x303A

        /** Finds the board, asks for USB permission if needed, and opens its data interface. */
        fun open(context: Context, cancelled: () -> Boolean): LeekUsbLink {
            val manager = context.getSystemService(UsbManager::class.java)
                ?: throw LeekLinkException("LeekUsbMissing", "This phone has no USB host support.")
            val device = manager.deviceList.values.firstOrNull { it.vendorId == ESPRESSIF_VID }
                ?: throw LeekLinkException(
                    "LeekUsbNotFound",
                    "No LeekWallet found over USB. Connect the board's USB port with a USB-OTG cable.",
                )
            if (!manager.hasPermission(device) && !requestPermission(context, manager, device, cancelled)) {
                throw LeekLinkException("LeekUsbPermission", "USB permission was not granted.")
            }
            for (i in 0 until device.interfaceCount) {
                val intf = device.getInterface(i)
                if (intf.interfaceClass != UsbConstants.USB_CLASS_CDC_DATA) continue
                var inEp: UsbEndpoint? = null
                var outEp: UsbEndpoint? = null
                for (e in 0 until intf.endpointCount) {
                    val ep = intf.getEndpoint(e)
                    if (ep.type != UsbConstants.USB_ENDPOINT_XFER_BULK) continue
                    if (ep.direction == UsbConstants.USB_DIR_IN) inEp = ep else outEp = ep
                }
                if (inEp == null || outEp == null) continue
                val connection = manager.openDevice(device)
                    ?: throw LeekLinkException("LeekUsbOpen", "The board's USB port could not be opened.")
                if (!connection.claimInterface(intf, true)) {
                    connection.close()
                    throw LeekLinkException("LeekUsbOpen", "The board's USB interface could not be claimed.")
                }
                return LeekUsbLink(manager, device, connection, intf, inEp, outEp)
            }
            throw LeekLinkException("LeekUsbOpen", "No CDC data interface: connect the board's USB port.")
        }

        private fun requestPermission(
            context: Context,
            manager: UsbManager,
            device: UsbDevice,
            cancelled: () -> Boolean,
        ): Boolean {
            val answer = CountDownLatch(1)
            val granted = AtomicBoolean(false)
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    granted.set(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false))
                    answer.countDown()
                }
            }
            ContextCompat.registerReceiver(
                context,
                receiver,
                IntentFilter(ACTION_USB_PERMISSION),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            try {
                val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
                val intent = Intent(ACTION_USB_PERMISSION).setPackage(context.packageName)
                manager.requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, flags))
                val deadline = System.currentTimeMillis() + PERMISSION_TIMEOUT_MS
                while (!answer.await(200, TimeUnit.MILLISECONDS)) {
                    if (cancelled() || System.currentTimeMillis() > deadline) return false
                }
                return granted.get()
            } finally {
                context.unregisterReceiver(receiver)
            }
        }
    }
}
