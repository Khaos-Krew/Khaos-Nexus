package com.khaosnexus.mobile

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.khaosnexus.mobile.data.SecureStore
import com.khaosnexus.mobile.model.*
import com.khaosnexus.mobile.network.GatewayException
import com.khaosnexus.mobile.network.MobileGatewayClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class NexusUiState(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val session: StoredSession? = null,
    val pairingText: String = "",
    val pairingPayload: PairingPayload? = null,
    val deviceName: String = "Android device",
    val fingerprintConfirmed: Boolean = false,
    val pairingBusy: Boolean = false,
    val pairingStatus: String = "",
    val error: String = "",
    val selectedSection: NexusSection = NexusSection.COMMAND_DECK,
    val dashboard: DashboardData = DashboardData(),
    val discord: DiscordData = DiscordData(),
    val servers: List<ServerData> = emptyList(),
    val modules: List<ModuleData> = emptyList(),
    val logs: List<LogData> = emptyList(),
    val statusPanels: List<StatusPanelData> = emptyList(),
    val update: UpdateData = UpdateData(),
    val lastUpdatedAt: Long = 0L
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val secureStore = SecureStore(application)
    private val client = MobileGatewayClient(secureStore)
    private val _state = MutableStateFlow(NexusUiState())
    val state: StateFlow<NexusUiState> = _state.asStateFlow()
    private var refreshLoop: Job? = null

    init {
        viewModelScope.launch {
            val session = withContext(Dispatchers.IO) { secureStore.loadSession() }
            _state.value = _state.value.copy(loading = false, session = session)
            if (session != null) {
                refresh()
                startRefreshLoop()
            }
        }
    }

    fun selectSection(section: NexusSection) { _state.value = _state.value.copy(selectedSection = section) }
    fun updatePairingText(value: String) { _state.value = _state.value.copy(pairingText = value, error = "") }
    fun updateDeviceName(value: String) { _state.value = _state.value.copy(deviceName = value.take(80)) }
    fun setFingerprintConfirmed(value: Boolean) { _state.value = _state.value.copy(fingerprintConfirmed = value) }

    fun loadPairingUri(value: String) {
        runCatching { PairingPayload.parse(value) }
            .onSuccess { payload ->
                _state.value = _state.value.copy(
                    pairingText = value,
                    pairingPayload = payload,
                    fingerprintConfirmed = false,
                    pairingStatus = "Verify this certificate fingerprint against the desktop before approving.",
                    error = ""
                )
            }
            .onFailure { error -> _state.value = _state.value.copy(error = error.message ?: "Invalid pairing link.") }
    }

    fun beginPairing() {
        val snapshot = _state.value
        val payload = snapshot.pairingPayload ?: return setError("Load a QR code or pairing link first.")
        if (!snapshot.fingerprintConfirmed) return setError("Confirm the desktop certificate fingerprint before pairing.")
        if (snapshot.deviceName.trim().isEmpty()) return setError("Enter a device name.")
        if (snapshot.pairingBusy) return

        viewModelScope.launch {
            _state.value = _state.value.copy(pairingBusy = true, pairingStatus = "Sending signed device enrollment request…", error = "")
            try {
                val request = withContext(Dispatchers.IO) { client.requestPairing(payload, snapshot.deviceName) }
                _state.value = _state.value.copy(pairingStatus = "Waiting for Owner approval on the desktop…")
                val expiresAt = System.currentTimeMillis() + 5 * 60_000
                var waitMs = request.pollAfterMs.coerceIn(1000, 5000)
                while (isActive && System.currentTimeMillis() < expiresAt) {
                    delay(waitMs)
                    val completion = withContext(Dispatchers.IO) { client.completePairing(payload, request.requestId, request.claimSecret) }
                    if (completion.pending) {
                        waitMs = completion.pollAfterMs.coerceIn(1000, 5000)
                        continue
                    }
                    val session = StoredSession(
                        endpoint = payload.endpoint,
                        fingerprint = PairingPayload.normalizeFingerprint(completion.certificateFingerprint.ifBlank { payload.fingerprint }),
                        deviceId = completion.deviceId,
                        role = completion.role,
                        credential = completion.credential
                    )
                    withContext(Dispatchers.IO) { secureStore.saveSession(session) }
                    _state.value = _state.value.copy(
                        session = session,
                        pairingBusy = false,
                        pairingStatus = "Paired securely.",
                        selectedSection = NexusSection.COMMAND_DECK,
                        error = ""
                    )
                    refresh()
                    startRefreshLoop()
                    return@launch
                }
                throw IllegalStateException("The pairing approval window expired.")
            } catch (error: Exception) {
                _state.value = _state.value.copy(pairingBusy = false, pairingStatus = "", error = error.message ?: "Pairing failed.")
            }
        }
    }

    fun refresh() {
        val session = _state.value.session ?: return
        if (_state.value.refreshing) return
        viewModelScope.launch {
            _state.value = _state.value.copy(refreshing = true, error = "")
            try {
                val result = withContext(Dispatchers.IO) {
                    RefreshedState(
                        dashboard = client.dashboard(session),
                        discord = client.discord(session),
                        servers = client.servers(session),
                        modules = client.modules(session),
                        logs = client.logs(session),
                        panels = client.statusPanels(session),
                        update = client.update(session)
                    )
                }
                _state.value = _state.value.copy(
                    refreshing = false,
                    dashboard = result.dashboard,
                    discord = result.discord,
                    servers = result.servers,
                    modules = result.modules,
                    logs = result.logs,
                    statusPanels = result.panels,
                    update = result.update,
                    lastUpdatedAt = System.currentTimeMillis(),
                    error = ""
                )
            } catch (error: GatewayException) {
                if (error.status == 401 || error.code == "DEVICE_REVOKED" || error.code == "AUTH_FAILED") {
                    withContext(Dispatchers.IO) { secureStore.clearSession() }
                    refreshLoop?.cancel()
                    _state.value = NexusUiState(loading = false, error = "This phone was revoked or its device credential is no longer valid.")
                } else {
                    _state.value = _state.value.copy(refreshing = false, error = error.message)
                }
            } catch (error: Exception) {
                _state.value = _state.value.copy(refreshing = false, error = error.message ?: "The desktop could not be reached.")
            }
        }
    }

    fun forgetDesktop() {
        viewModelScope.launch {
            refreshLoop?.cancel()
            withContext(Dispatchers.IO) { secureStore.clearSession(removeSigningKey = true) }
            _state.value = NexusUiState(loading = false)
        }
    }

    private fun startRefreshLoop() {
        refreshLoop?.cancel()
        refreshLoop = viewModelScope.launch {
            while (isActive) {
                delay(15_000)
                refresh()
            }
        }
    }

    private fun setError(message: String) { _state.value = _state.value.copy(error = message) }

    private data class RefreshedState(
        val dashboard: DashboardData,
        val discord: DiscordData,
        val servers: List<ServerData>,
        val modules: List<ModuleData>,
        val logs: List<LogData>,
        val panels: List<StatusPanelData>,
        val update: UpdateData
    )
}
