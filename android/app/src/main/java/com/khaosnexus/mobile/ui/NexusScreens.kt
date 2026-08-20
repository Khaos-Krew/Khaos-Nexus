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
import androidx.compose.ui.text.input.PasswordVisualTransformation
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
    onNexusAddress: (String) -> Unit,
    onUsername: (String) -> Unit,
    onPassword: (String) -> Unit,
    onDeviceName: (String) -> Unit,
    onProbe: () -> Unit,
    onFingerprintConfirmed: (Boolean) -> Unit,
    onSignIn: () -> Unit,
    onUnlock: () -> Unit,
    onRefresh: () -> Unit,
    onSelectSection: (NexusSection) -> Unit,
    onForget: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Khaos Nexus", fontWeight = FontWeight.Black)
                        Text(
                            when {
                                state.session == null -> "Secure Account Login"
                                !state.sessionUnlocked -> "Nexus Locked"
                                else -> "Remote Command Deck"
                            },
                            style = MaterialTheme.typography.labelSmall
                        )
                    }
                },
                actions = {
                    if (state.session != null && state.sessionUnlocked) {
                        TextButton(onClick = onRefresh, enabled = !state.refreshing) { Text(if (state.refreshing) "Refreshing" else "Refresh") }
                    }
                }
            )
        }
    ) { padding ->
        when {
            state.loading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            state.session == null -> LoginScreen(state, onNexusAddress, onUsername, onPassword, onDeviceName, onProbe, onFingerprintConfirmed, onSignIn, Modifier.padding(padding))
            !state.sessionUnlocked -> LockedScreen(state, onUnlock, onForget, Modifier.padding(padding))
            else -> DashboardScreen(state, onSelectSection, onForget, Modifier.padding(padding))
        }
    }
}

@Composable
private fun LoginScreen(
    state: NexusUiState,
    onNexusAddress: (String) -> Unit,
    onUsername: (String) -> Unit,
    onPassword: (String) -> Unit,
    onDeviceName: (String) -> Unit,
    onProbe: () -> Unit,
    onFingerprintConfirmed: (Boolean) -> Unit,
    onSignIn: () -> Unit,
    modifier: Modifier
) {
    LazyColumn(modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Hero("Sign in to your Nexus", "Connect through your trusted private network/VPN. The app verifies the Nexus certificate before it will send your password.") }
        item { ErrorBanner(state.error) }
        item {
            NexusCard {
                Text("1 • Find Nexus", fontWeight = FontWeight.Bold)
                OutlinedTextField(
                    value = state.nexusAddress,
                    onValueChange = onNexusAddress,
                    label = { Text("Nexus address") },
                    supportingText = { Text("Example: 100.x.x.x:43120 or your private-network hostname") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Button(onClick = onProbe, enabled = !state.loginBusy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (state.loginBusy && state.probe == null) "Checking Nexus…" else "Verify Nexus Connection")
                }
            }
        }
        state.probe?.let { probe ->
            item {
                NexusCard {
                    Text("2 • Verify certificate", fontWeight = FontWeight.Bold)
                    Text("${probe.service} • ${probe.version}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("Certificate SHA-256", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
                    Text(probe.fingerprint, style = MaterialTheme.typography.bodySmall)
                    Text("Compare this once with the certificate fingerprint shown on the Nexus desktop Mobile Companion page.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = state.fingerprintConfirmed, onCheckedChange = onFingerprintConfirmed)
                        Text("I verified this Nexus certificate")
                    }
                }
            }
            item {
                NexusCard {
                    Text("3 • Account login", fontWeight = FontWeight.Bold)
                    OutlinedTextField(value = state.username, onValueChange = onUsername, label = { Text("Nexus username") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(
                        value = state.password,
                        onValueChange = onPassword,
                        label = { Text("Password") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(value = state.deviceName, onValueChange = onDeviceName, label = { Text("This phone") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Button(onClick = onSignIn, enabled = state.fingerprintConfirmed && !state.loginBusy, modifier = Modifier.fillMaxWidth()) {
                        Text(if (state.loginBusy) "Signing in…" else "Sign In")
                    }
                    if (state.loginStatus.isNotBlank()) Text(state.loginStatus, color = MaterialTheme.colorScheme.secondary)
                    Text("Your password is used only for this sign-in. Nexus replaces it with a revocable encrypted device credential stored using Android Keystore.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun LockedScreen(state: NexusUiState, onUnlock: () -> Unit, onForget: () -> Unit, modifier: Modifier) {
    Box(modifier.fillMaxSize().padding(22.dp), contentAlignment = Alignment.Center) {
        NexusCard {
            Text("Nexus session locked", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
            Text("Unlock with your phone biometrics or device credential. Your saved Nexus session remains encrypted in Android Keystore.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(state.session?.endpoint.orEmpty(), style = MaterialTheme.typography.bodySmall)
            Button(onClick = onUnlock, modifier = Modifier.fillMaxWidth()) { Text("Unlock Nexus") }
            OutlinedButton(onClick = onForget, modifier = Modifier.fillMaxWidth()) { Text("Forget This Nexus") }
            ErrorBanner(state.error)
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
    item { Hero("Command Deck", "Live public-safe status from your authenticated Khaos Nexus desktop.") }
    item {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric("Discord", state.dashboard.discordStatus, Modifier.weight(1f))
            Metric("Servers", "${state.dashboard.onlineServers}/${state.dashboard.totalServers}", Modifier.weight(1f))
            Metric("Functions", "${state.dashboard.enabledModules}/${state.dashboard.totalModules}", Modifier.weight(1f))
        }
    }
    item { Metric("Desktop version", state.dashboard.desktopVersion, Modifier.fillMaxWidth()) }
    if (state.dashboard.alerts.isNotEmpty()) item { NexusCard { Text("Attention", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error); state.dashboard.alerts.forEach { Text("• $it") } } }
}

@Composable
private fun DiscordScreen(value: DiscordData) = ScreenList("Discord Runtime", listOf("Status" to value.status, "Bot" to value.username, "Guilds" to value.guildCount.toString(), "Latency" to "${value.latencyMs} ms", "Memory" to "${value.memoryMb} MB", "Uptime" to duration(value.uptimeSeconds), "Attention" to value.attention))

@Composable
private fun ServerScreen(values: List<ServerData>) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    item { Hero("Game Servers", "Remote health through Nexus. RCON and hosting credentials remain on the desktop.") }
    if (values.isEmpty()) item { EmptyState("No configured servers") }
    items(values, key = { it.id }) { value -> NexusCard { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Column(Modifier.weight(1f)) { Text(value.name, fontWeight = FontWeight.Bold); Text(value.game.uppercase(), color = MaterialTheme.colorScheme.onSurfaceVariant); if (value.error.isNotBlank()) Text(value.error, color = MaterialTheme.colorScheme.error) }; Status(value.status) } } }
}

@Composable
private fun ModuleScreen(values: List<ModuleData>) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    item { Hero("Nexus Functions", "Live capability catalog from the connected Nexus desktop. Function details update with Nexus without requiring the Android UI to hardcode a static list.") }
    if (values.isEmpty()) item { EmptyState("No Nexus functions were reported") }
    items(values, key = { it.id }) { value ->
        NexusCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(value.name, fontWeight = FontWeight.Bold)
                    Text(listOf(value.workspace, value.category).filter { it.isNotBlank() }.joinToString(" • "), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (value.description.isNotBlank()) Text(value.description)
                }
                Status(value.statusLabel.ifBlank { if (value.enabled) "available" else value.availability.ifBlank { "disabled" } })
            }
            if (value.features.isNotEmpty()) {
                HorizontalDivider()
                Text("Current functions", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                value.features.take(12).forEach { feature -> Text("• $feature", style = MaterialTheme.typography.bodySmall) }
            }
            Text("${value.stage.ifBlank { "current" }} • ${value.progress}% • ${value.requiredRole} access", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
            if (value.reason.isNotBlank() && value.reason != "enabled") Text(value.reason, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun LogScreen(values: List<LogData>) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    item { Hero("Activity Logs", "Recent redacted Nexus events. Protected values are removed before transport.") }
    items(values.takeLast(200).reversed()) { value -> NexusCard { Text("${value.level.uppercase()} • ${value.source}", color = logColor(value.level), style = MaterialTheme.typography.labelMedium); Text(value.message, maxLines = 5, overflow = TextOverflow.Ellipsis); Text(value.time, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall) } }
}

@Composable
private fun PanelScreen(values: List<StatusPanelData>) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    item { Hero("Status Panels", "Published Discord status-panel health.") }
    items(values, key = { it.id }) { value -> NexusCard { Text(value.name, fontWeight = FontWeight.Bold); Text(if (value.published) "Published" else "Not published", color = if (value.published) Color(0xFF67E8AD) else MaterialTheme.colorScheme.onSurfaceVariant); if (value.lastError.isNotBlank()) Text(value.lastError, color = MaterialTheme.colorScheme.error) } }
}

@Composable
private fun SettingsScreen(state: NexusUiState, onForget: () -> Unit) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    item { Hero("Device Session", "Account login establishes a revocable device credential; each API request is certificate-pinned and P-256 signed.") }
    item { NexusCard { Text("Nexus", fontWeight = FontWeight.Bold); Text(state.session?.endpoint.orEmpty()); Text("Role: ${state.session?.role.orEmpty()}"); Text("Last refresh: ${time(state.lastUpdatedAt)}"); HorizontalDivider(); Button(onClick = onForget, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error), modifier = Modifier.fillMaxWidth()) { Text("Forget Nexus & Sign Out") } } }
}

@Composable
private fun ScreenList(title: String, values: List<Pair<String, String>>) = LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    item { Hero(title, "Live read-only Nexus state.") }
    items(values.filter { it.second.isNotBlank() }) { (name, value) -> Metric(name, value, Modifier.fillMaxWidth()) }
}

@Composable private fun Hero(title: String, subtitle: String) = Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.primary.copy(alpha = .10f), border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = .45f))) { Column(Modifier.fillMaxWidth().padding(18.dp)) { Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black); Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
@Composable private fun NexusCard(content: @Composable ColumnScope.() -> Unit) = Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .35f))) { Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp), content = content) }
@Composable private fun Metric(label: String, value: String, modifier: Modifier) = Surface(modifier, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .55f)) { Column(Modifier.padding(14.dp)) { Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium); Text(value.ifBlank { "—" }, fontWeight = FontWeight.Bold) } }
@Composable private fun Status(value: String) = Text(value.uppercase(), color = statusColor(value), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
@Composable private fun ErrorBanner(message: String, modifier: Modifier = Modifier) { if (message.isNotBlank()) Surface(modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.error.copy(alpha = .12f), shape = MaterialTheme.shapes.medium) { Text(message, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error) } }
@Composable private fun EmptyState(message: String) = NexusCard { Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant) }
private fun statusColor(value: String) = when (value.lowercase()) { "online", "enabled", "available" -> Color(0xFF67E8AD); "degraded", "in development" -> Color(0xFFFFC857); "disabled", "planned", "paused" -> Color(0xFF8A94A4); else -> Color(0xFFFF6D82) }
private fun logColor(value: String) = when (value.lowercase()) { "error", "fatal" -> Color(0xFFFF6D82); "warn", "warning" -> Color(0xFFFFC857); else -> Color(0xFF56D9FF) }
private fun duration(seconds: Long): String { val s = seconds.coerceAtLeast(0); return if (s >= 86400) "${s / 86400}d ${(s % 86400) / 3600}h" else if (s >= 3600) "${s / 3600}h ${(s % 3600) / 60}m" else "${s / 60}m" }
private fun time(value: Long): String = if (value <= 0) "Never" else DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(value))
