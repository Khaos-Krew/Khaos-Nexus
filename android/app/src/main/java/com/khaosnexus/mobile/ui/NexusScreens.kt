package com.khaosnexus.mobile.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.khaosnexus.mobile.NexusUiState
import com.khaosnexus.mobile.model.*
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NexusApp(
    state: NexusUiState,
    onScan: () -> Unit,
    onPairingText: (String) -> Unit,
    onLoadPairing: (String) -> Unit,
    onDeviceName: (String) -> Unit,
    onFingerprintConfirmed: (Boolean) -> Unit,
    onPair: () -> Unit,
    onRefresh: () -> Unit,
    onSelectSection: (NexusSection) -> Unit,
    onForget: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Column { Text("Khaos Nexus", fontWeight = FontWeight.Black); Text(if (state.session == null) "Secure Pairing" else "Read-only Command Deck", style = MaterialTheme.typography.labelSmall) } },
                actions = { if (state.session != null) TextButton(onClick = onRefresh, enabled = !state.refreshing) { Text(if (state.refreshing) "Refreshing" else "Refresh") } }
            )
        }
    ) { padding ->
        if (state.loading) Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else if (state.session == null) PairingScreen(state, onScan, onPairingText, onLoadPairing, onDeviceName, onFingerprintConfirmed, onPair, Modifier.padding(padding))
        else DashboardScreen(state, onSelectSection, onForget, Modifier.padding(padding))
    }
}

@Composable
private fun PairingScreen(
    state: NexusUiState,
    onScan: () -> Unit,
    onPairingText: (String) -> Unit,
    onLoadPairing: (String) -> Unit,
    onDeviceName: (String) -> Unit,
    onFingerprintConfirmed: (Boolean) -> Unit,
    onPair: () -> Unit,
    modifier: Modifier
) {
    LazyColumn(modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Hero("Pair this phone", "Scan the one-time desktop QR code. RCON, Discord, GitHub, hosting, and game credentials remain on the PC.") }
        item { ErrorBanner(state.error) }
        item {
            NexusCard {
                Button(onClick = onScan, modifier = Modifier.fillMaxWidth()) { Text("Scan Desktop QR Code") }
                OutlinedTextField(value = state.pairingText, onValueChange = onPairingText, label = { Text("Pairing link") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                OutlinedButton(onClick = { onLoadPairing(state.pairingText) }, modifier = Modifier.fillMaxWidth()) { Text("Load Pairing Link") }
            }
        }
        state.pairingPayload?.let { payload ->
            item {
                NexusCard {
                    Text("Desktop certificate SHA-256", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
                    Text(payload.fingerprint, style = MaterialTheme.typography.bodySmall)
                    Text("Compare this fingerprint with the desktop before continuing.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = state.fingerprintConfirmed, onCheckedChange = onFingerprintConfirmed)
                        Text("I verified the fingerprint")
                    }
                    OutlinedTextField(value = state.deviceName, onValueChange = onDeviceName, label = { Text("Device name") }, modifier = Modifier.fillMaxWidth())
                    Button(onClick = onPair, enabled = state.fingerprintConfirmed && !state.pairingBusy, modifier = Modifier.fillMaxWidth()) { Text(if (state.pairingBusy) "Waiting for Owner approval…" else "Request Pairing") }
                    if (state.pairingStatus.isNotBlank()) Text(state.pairingStatus, color = MaterialTheme.colorScheme.secondary)
                }
            }
        }
    }
}

@Composable
private fun DashboardScreen(state: NexusUiState, onSelectSection: (NexusSection) -> Unit, onForget: () -> Unit, modifier: Modifier) {
    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            NexusSection.entries.forEach { section -> FilterChip(selected = state.selectedSection == section, onClick = { onSelectSection(section) }, label = { Text(section.label) }) }
        }
        ErrorBanner(state.error, Modifier.padding(horizontal = 14.dp))
        when (state.selectedSection) {
            NexusSection.COMMAND_DECK -> CommandDeck(state)
            NexusSection.DISCORD -> DiscordScreen(state.discord)
            NexusSection.SERVERS -> ServerScreen(state.servers)
            NexusSection.MODULES -> ModuleScreen(state.modules)
            NexusSection.LOGS -> LogScreen(state.logs)
            NexusSection.PANELS -> PanelScreen(state.statusPanels)
            NexusSection.SETTINGS -> SettingsScreen(state, onForget)
        }
    }
}

@Composable
private fun CommandDeck(state: NexusUiState) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    item { Hero("Command Deck", "Live public-safe status from the paired Khaos Nexus desktop.") }
    item {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric("Discord", state.dashboard.discordStatus, Modifier.weight(1f))
            Metric("Servers", "${state.dashboard.onlineServers}/${state.dashboard.totalServers}", Modifier.weight(1f))
            Metric("Modules", "${state.dashboard.enabledModules}/${state.dashboard.totalModules}", Modifier.weight(1f))
        }
    }
    item { Metric("Desktop version", state.dashboard.desktopVersion, Modifier.fillMaxWidth()) }
    if (state.dashboard.alerts.isNotEmpty()) item { NexusCard { Text("Attention", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error); state.dashboard.alerts.forEach { Text("• $it") } } }
}

@Composable
private fun DiscordScreen(value: DiscordData) = ScreenList("Discord Runtime", listOf("Status" to value.status, "Bot" to value.username, "Guilds" to value.guildCount.toString(), "Latency" to "${value.latencyMs} ms", "Memory" to "${value.memoryMb} MB", "Uptime" to duration(value.uptimeSeconds), "Attention" to value.attention))

@Composable
private fun ServerScreen(values: List<ServerData>) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    item { Hero("Game Servers", "Read-only health. No direct RCON connection exists on this phone.") }
    if (values.isEmpty()) item { EmptyState("No configured servers") }
    items(values, key = { it.id }) { value -> NexusCard { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Column(Modifier.weight(1f)) { Text(value.name, fontWeight = FontWeight.Bold); Text(value.game.uppercase(), color = MaterialTheme.colorScheme.onSurfaceVariant); if (value.error.isNotBlank()) Text(value.error, color = MaterialTheme.colorScheme.error) }; Status(value.status) } } }
}

@Composable
private fun ModuleScreen(values: List<ModuleData>) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    item { Hero("Modules", "Effective Owner-controlled module state from the desktop.") }
    items(values, key = { it.id }) { value -> NexusCard { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Column(Modifier.weight(1f)) { Text(value.name, fontWeight = FontWeight.Bold); Text("${value.category} • ${value.stage} • ${value.progress}%", color = MaterialTheme.colorScheme.onSurfaceVariant); if (value.reason.isNotBlank()) Text(value.reason) }; Status(if (value.enabled) "enabled" else "disabled") } } }
}

@Composable
private fun LogScreen(values: List<LogData>) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    item { Hero("Activity Logs", "Recent redacted desktop events. Protected values are removed before transport.") }
    items(values.takeLast(200).reversed()) { value -> NexusCard { Text("${value.level.uppercase()} • ${value.source}", color = logColor(value.level), style = MaterialTheme.typography.labelMedium); Text(value.message, maxLines = 5, overflow = TextOverflow.Ellipsis); Text(value.time, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall) } }
}

@Composable
private fun PanelScreen(values: List<StatusPanelData>) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    item { Hero("Status Panels", "Published Discord status-panel health.") }
    items(values, key = { it.id }) { value -> NexusCard { Text(value.name, fontWeight = FontWeight.Bold); Text(if (value.published) "Published" else "Not published", color = if (value.published) Color(0xFF67E8AD) else MaterialTheme.colorScheme.onSurfaceVariant); if (value.lastError.isNotBlank()) Text(value.lastError, color = MaterialTheme.colorScheme.error) } }
}

@Composable
private fun SettingsScreen(state: NexusUiState, onForget: () -> Unit) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    item { Hero("Device Session", "The device credential is encrypted with Android Keystore and each request is P-256 signed.") }
    item { NexusCard { Text("Desktop", fontWeight = FontWeight.Bold); Text(state.session?.endpoint.orEmpty()); Text("Role: ${state.session?.role.orEmpty()}"); Text("Last refresh: ${time(state.lastUpdatedAt)}"); HorizontalDivider(); Button(onClick = onForget, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error), modifier = Modifier.fillMaxWidth()) { Text("Forget Desktop") } } }
}

@Composable
private fun ScreenList(title: String, values: List<Pair<String, String>>) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    item { Hero(title, "Live read-only desktop state.") }
    items(values.filter { it.second.isNotBlank() }) { (name, value) -> Metric(name, value, Modifier.fillMaxWidth()) }
}

@Composable private fun Hero(title: String, subtitle: String) = Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.primary.copy(alpha = .10f), border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = .45f))) { Column(Modifier.fillMaxWidth().padding(18.dp)) { Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black); Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
@Composable private fun NexusCard(content: @Composable ColumnScope.() -> Unit) = Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .35f))) { Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp), content = content) }
@Composable private fun Metric(label: String, value: String, modifier: Modifier) = Surface(modifier, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .55f)) { Column(Modifier.padding(14.dp)) { Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium); Text(value.ifBlank { "—" }, fontWeight = FontWeight.Bold) } }
@Composable private fun Status(value: String) = Text(value.uppercase(), color = statusColor(value), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
@Composable private fun ErrorBanner(message: String, modifier: Modifier = Modifier) { if (message.isNotBlank()) Surface(modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.error.copy(alpha = .12f), shape = MaterialTheme.shapes.medium) { Text(message, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error) } }
@Composable private fun EmptyState(message: String) = NexusCard { Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant) }
private fun statusColor(value: String) = when (value.lowercase()) { "online", "enabled" -> Color(0xFF67E8AD); "degraded" -> Color(0xFFFFC857); "disabled" -> Color(0xFF8A94A4); else -> Color(0xFFFF6D82) }
private fun logColor(value: String) = when (value.lowercase()) { "error", "fatal" -> Color(0xFFFF6D82); "warn", "warning" -> Color(0xFFFFC857); else -> Color(0xFF56D9FF) }
private fun duration(seconds: Long): String { val s = seconds.coerceAtLeast(0); return if (s >= 86400) "${s / 86400}d ${(s % 86400) / 3600}h" else if (s >= 3600) "${s / 3600}h ${(s % 3600) / 60}m" else "${s / 60}m" }
private fun time(value: Long): String = if (value <= 0) "Never" else DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(value))
