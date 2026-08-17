package com.khaosnexus.mobile

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.khaosnexus.mobile.data.SecureStore
import com.khaosnexus.mobile.model.*
import com.khaosnexus.mobile.network.GatewayException
import com.khaosnexus.mobile.network.GatewayProbe
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
    val sessionUnlocked: Boolean = false,
    val nexusAddress: String = "",
    val username: String = "",
    val password: String = "",
    val deviceName: String = "Android phone",
    val probe: GatewayProbe? = null,
    val fingerprintConfirmed: Boolean = false,
    val loginBusy: Boolean = false,
    val loginStatus: String = "",
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
            _state.value = _state.value.copy(
                loading = false,
                session = session,
                sessionUnlocked = false,
                nexusAddress = session?.endpoint.orEmpty()
            )
        }
    }

    fun selectSection(section: NexusSection) { _state.value = _state.value.copy(selectedSection = section) }

    fun updateNexusAddress(value: String) {
        _state.value = _state.value.copy(
            nexusAddress = value.take(300),
            probe = null,
            fingerprintConfirmed = false,
            loginStatus = "",
            error = ""
        )
    }

    fun updateUsername(value: String) { _state.value = _state.value.copy(username = value.take(64), error = "") }
    fun updatePassword(value: String) { _state.value = _state.value.copy(password = value.take(256), error = "") }
    fun updateDeviceName(value: String) { _state.value = _state.value.copy(deviceName = value.take(80), error = "") }
    fun setFingerprintConfirmed(value: Boolean) { _state.value = _state.value.copy(fingerprintConfirmed = value, error = "") }

    fun probeNexus() {
        val address = _state.value.nexusAddress.trim()
        if (address.isEmpty()) return setError("Enter your Nexus private-network address first.")
        if (_state.value.loginBusy) return
        viewModelScope.launch {
            _state.value = _state.value.copy(loginBusy = true, probe = null, fingerprintConfirmed = false, loginStatus = "Contacting Nexus…", error = "")
            try {
                val probe = withContext(Dispatchers.IO) { client.probe(address) }
                _state.value = _state.value.copy(
                    loginBusy = false,
                    nexusAddress = probe.endpoint,
                    probe = probe,
                    fingerprintConfirmed = false,
                    loginStatus = "Verify the certificate fingerprint shown here against the Mobile Companion page on your Nexus desktop before signing in.",
                    error = ""
                )
            } catch (error: Exception) {
                _state.value = _state.value.copy(loginBusy = false, loginStatus = "", error = error.message ?: "Nexus could not be reached.")
            }
        }
    }

    fun signIn() {
        val snapshot = _state.value
        val probe = snapshot.probe ?: return setError("Verify the Nexus connection before signing in.")
        if (!snapshot.fingerprintConfirmed) return setError("Confirm the Nexus certificate fingerprint before signing in.")
        if (snapshot.username.trim().isEmpty()) return setError("Enter your Nexus username.")
        if (snapshot.password.isEmpty()) return setError("Enter your Nexus password.")
        if (snapshot.deviceName.trim().isEmpty()) return setError("Enter a name for this phone.")
        if (snapshot.loginBusy) return

        viewModelScope.launch {
            _state.value = _state.value.copy(loginBusy = true, loginStatus = "Signing in securely…", error = "")
            try {
                val session = withContext(Dispatchers.IO) {
                    client.login(probe.endpoint, probe.fingerprint, snapshot.username, snapshot.password, snapshot.deviceName)
                }
                withContext(Dispatchers.IO) { secureStore.saveSession(session) }
                _state.value = _state.value.copy(
                    session = session,
                    sessionUnlocked = true,
                    password = "",
                    loginBusy = false,
                    loginStatus = "Signed in. This phone now uses a revocable encrypted device session.",
                    selectedSection = NexusSection.COMMAND_DECK,
                    error = ""
                )
                refresh()
                startRefreshLoop()
            } catch (error: Exception) {
                _state.value = _state.value.copy(loginBusy = false, password = "", loginStatus = "", error = error.message ?: "Sign-in failed.")
            }
        }
    }

    fun reportUnlockError(message: String) { setError(message) }

    fun unlockSession() {
        if (_state.value.session == null) return
        _state.value = _state.value.copy(sessionUnlocked = true, error = "")
        refresh()
        startRefreshLoop()
    }

    fun refresh() {
        val snapshot = _state.value
        val session = snapshot.session ?: return
        if (!snapshot.sessionUnlocked || snapshot.refreshing) return
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
                    _state.value = NexusUiState(loading = false, error = "This phone was revoked or its device credential is no longer valid. Sign in again to reconnect it.")
                } else {
                    _state.value = _state.value.copy(refreshing = false, error = error.message)
                }
            } catch (error: Exception) {
                _state.value = _state.value.copy(refreshing = false, error = error.message ?: "Nexus could not be reached.")
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
