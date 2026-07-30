package com.khaosnexus.mobile.model

import android.net.Uri

data class PairingPayload(val endpoint: String, val code: String, val fingerprint: String, val sessionId: String) {
    companion object {
        fun parse(value: String): PairingPayload {
            val uri = Uri.parse(value.trim()); require(uri.scheme == "khaosnexus" && uri.host == "pair") { "This is not a Khaos Nexus pairing link." }
            val endpoint = uri.getQueryParameter("endpoint")?.trim().orEmpty(); val code = uri.getQueryParameter("code")?.trim().orEmpty()
            val fingerprint = normalizeFingerprint(uri.getQueryParameter("fingerprint").orEmpty()); val session = uri.getQueryParameter("session")?.trim().orEmpty()
            require(endpoint.startsWith("https://")) { "The pairing endpoint must use HTTPS." }; require(code.matches(Regex("^\\d{6}$"))) { "The pairing code must contain six digits." }; require(fingerprint.length == 95) { "The certificate fingerprint is invalid." }
            return PairingPayload(endpoint.removeSuffix("/"), code, fingerprint, session)
        }
        fun normalizeFingerprint(value: String): String = value.filter { it.isDigit() || it.lowercaseChar() in 'a'..'f' }.uppercase().chunked(2).joinToString(":")
    }
}

data class StoredSession(val endpoint: String, val fingerprint: String, val deviceId: String, val role: String, val credential: String)
data class DashboardData(val desktopVersion: String = "Unknown", val discordStatus: String = "Unknown", val onlineServers: Int = 0, val totalServers: Int = 0, val players: Int = 0, val enabledModules: Int = 0, val totalModules: Int = 0, val updateAvailable: Boolean = false, val alerts: List<String> = emptyList(), val checkedAt: String = "")
data class DiscordData(val status: String = "stopped", val username: String = "", val latencyMs: Int = 0, val uptimeSeconds: Long = 0, val memoryMb: Int = 0, val guildCount: Int = 0, val attention: String = "")
data class ServerData(val id: String, val name: String, val game: String, val status: String, val players: Int, val maxPlayers: Int, val fps: Double?, val uptimeSeconds: Long, val map: String, val error: String)
data class ModuleData(val id: String, val name: String, val category: String, val stage: String, val availability: String, val enabled: Boolean, val reason: String, val progress: Int)
data class LogData(val time: String, val source: String, val level: String, val message: String)
data class StatusPanelData(val id: String, val name: String, val serverName: String, val published: Boolean, val lastRefreshedAt: String, val lastError: String)
data class UpdateData(val status: String = "idle", val currentVersion: String = "", val availableVersion: String = "", val available: Boolean = false, val downloaded: Boolean = false, val progressPercent: Int = 0, val error: String = "")
enum class NexusSection(val label: String) { COMMAND_DECK("Command Deck"), DISCORD("Discord"), SERVERS("Servers"), MODULES("Modules"), LOGS("Logs"), PANELS("Panels"), SETTINGS("Settings") }
