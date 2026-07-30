package com.khaosnexus.mobile

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.khaosnexus.mobile.ui.NexusApp
import com.khaosnexus.mobile.ui.NexusTheme

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        handleIntent(intent)
        setContent {
            val state by viewModel.state.collectAsStateWithLifecycle()
            NexusTheme {
                NexusApp(
                    state = state,
                    onScan = ::scanPairingCode,
                    onPairingText = viewModel::updatePairingText,
                    onLoadPairing = viewModel::loadPairingUri,
                    onDeviceName = viewModel::updateDeviceName,
                    onFingerprintConfirmed = viewModel::setFingerprintConfirmed,
                    onPair = viewModel::beginPairing,
                    onRefresh = viewModel::refresh,
                    onSelectSection = viewModel::selectSection,
                    onForget = viewModel::forgetDesktop
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        intent?.dataString?.takeIf { it.startsWith("khaosnexus://pair") }?.let(viewModel::loadPairingUri)
    }

    private fun scanPairingCode() {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { barcode -> barcode.rawValue?.let(viewModel::loadPairingUri) }
    }
}
