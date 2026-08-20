package com.khaosnexus.mobile

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khaosnexus.mobile.ui.NexusApp
import com.khaosnexus.mobile.ui.NexusTheme

class MainActivity : FragmentActivity() {
    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        setContent {
            val state by viewModel.state.collectAsStateWithLifecycle()
            NexusTheme {
                NexusApp(
                    state = state,
                    onNexusAddress = viewModel::updateNexusAddress,
                    onUsername = viewModel::updateUsername,
                    onPassword = viewModel::updatePassword,
                    onDeviceName = viewModel::updateDeviceName,
                    onProbe = viewModel::probeNexus,
                    onFingerprintConfirmed = viewModel::setFingerprintConfirmed,
                    onSignIn = viewModel::signIn,
                    onUnlock = ::unlockNexus,
                    onRefresh = viewModel::refresh,
                    onSelectSection = viewModel::selectSection,
                    onForget = viewModel::forgetDesktop
                )
            }
        }
    }

    private fun unlockNexus() {
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    super.onAuthenticationSucceeded(result)
                    viewModel.unlockSession()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    if (errorCode != BiometricPrompt.ERROR_USER_CANCELED && errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON) {
                        viewModel.reportUnlockError(errString.toString())
                    }
                }
            }
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock Khaos Nexus")
            .setSubtitle("Use biometrics or your device credential to open the saved Nexus session.")
            .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
            .build()
        prompt.authenticate(info)
    }
}
