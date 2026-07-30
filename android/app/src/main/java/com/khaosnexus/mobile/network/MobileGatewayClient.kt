package com.khaosnexus.mobile.network

import android.util.Base64
import com.khaosnexus.mobile.BuildConfig
import com.khaosnexus.mobile.data.SecureStore
import com.khaosnexus.mobile.model.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

class GatewayException(val status: Int, val code: String, override val message: String) : Exception(message)
data class PairingRequestResult(val requestId: String, val claimSecret: String, val expiresAt: String, val pollAfterMs: Long)
data class PairingCompleteResult(val pending: Boolean, val credential: String = "", val deviceId: String = "", val role: String = "viewer", val certificateFingerprint: String = "", val pollAfterMs: Long = 1500)

class MobileGatewayClient(private val secureStore: SecureStore) {
    private val random = SecureRandom()

    fun requestPairing(payload: PairingPayload, deviceName: String): PairingRequestResult {
        val body = JSONObject().put("code", payload.code).put("name", deviceName.trim().take(80)).put("publicKeyPem", secureStore.signingPublicKeyPem()).toString().toByteArray()
        val response = request("POST", "${payload.endpoint}/v1/pairing/request", payload.fingerprint, body = body)
        return PairingRequestResult(response.getString("requestId"), response.getString("claimSecret"), response.optString("expiresAt"), response.optLong("pollAfterMs", 1500))
    }

    fun completePairing(payload: PairingPayload, requestId: String, claimSecret: String): PairingCompleteResult {
        val body = JSONObject().put("requestId", requestId).put("claimSecret", claimSecret).toString().toByteArray()
        val response = request("POST", "${payload.endpoint}/v1/pairing/complete", payload.fingerprint, body = body, allowPending = true)
        if (response.optString("status") == "pending-owner-approval") return PairingCompleteResult(pending = true, pollAfterMs = response.optLong("pollAfterMs", 1500))
        return PairingCompleteResult(false, response.getString("credential"), response.getString("deviceId"), response.optString("role", "viewer"), response.optString("certificateFingerprint", payload.fingerprint))
    }

    fun get(session: StoredSession, pathAndQuery: String): JSONObject {
        require(pathAndQuery.startsWith("/v1/"))
        return request("GET", "${session.endpoint}$pathAndQuery", session.fingerprint, session = session)
    }

    fun dashboard(session: StoredSession): DashboardData {
        val root = get(session, "/v1/dashboard").getJSONObject("dashboard")
        val desktop = root.optJSONObject("desktop") ?: JSONObject()
        val discord = root.optJSONObject("discord") ?: JSONObject()
        val serverArray = root.optJSONArray("servers") ?: JSONArray()
        val totalServers = serverArray.length()
        val onlineServers = serverArray.objects().count { it.optString("status") == "online" }
        val modules = root.optJSONArray("modules") ?: JSONArray()
        val update = root.optJSONObject("update") ?: JSONObject()
        return DashboardData(
            desktopVersion = desktop.optString("version", "Unknown"),
            discordStatus = discord.optString("status", "Unknown"),
            onlineServers = onlineServers,
            totalServers = totalServers,
            players = serverArray.objects().sumOf { it.optInt("players") },
            enabledModules = modules.objects().count { it.optBoolean("effectiveEnabled") },
            totalModules = modules.length(),
            updateAvailable = update.optBoolean("available"),
            alerts = root.optJSONArray("alerts").strings(),
            checkedAt = root.optString("checkedAt")
        )
    }

    fun discord(session: StoredSession): DiscordData {
        val value = get(session, "/v1/discord").getJSONObject("discord")
        return DiscordData(value.optString("status", "stopped"), value.optString("username"), value.optInt("latencyMs"), value.optLong("uptimeSeconds"), value.optInt("memoryMb"), value.optInt("guildCount"), value.optString("attention"))
    }

    fun servers(session: StoredSession): List<ServerData> = get(session, "/v1/servers").getJSONArray("servers").objects().map { value ->
        ServerData(
            id = value.optString("id"), name = value.optString("name", "Server"), game = value.optString("game", "generic"), status = value.optString("status", "unknown"),
            players = value.optInt("players"), maxPlayers = value.optInt("maxPlayers"), fps = value.optDoubleOrNull("fps"), uptimeSeconds = value.optLong("uptimeSeconds"),
            map = value.optString("map"), error = value.optString("error", value.optString("detail"))
        )
    }

    fun modules(session: StoredSession): List<ModuleData> = get(session, "/v1/modules").getJSONArray("modules").objects().map { value ->
        ModuleData(value.optString("id"), value.optString("name", "Module"), value.optString("category"), value.optString("stage"), value.optString("availability"), value.optBoolean("effectiveEnabled"), value.optString("reason"), value.optInt("progress"))
    }

    fun logs(session: StoredSession): List<LogData> = get(session, "/v1/logs").getJSONArray("logs").objects().map { value ->
        LogData(value.optString("time"), value.optString("source", "manager"), value.optString("level", "info"), value.optString("message"))
    }

    fun statusPanels(session: StoredSession): List<StatusPanelData> = get(session, "/v1/status-panels").getJSONArray("statusPanels").objects().map { value ->
        StatusPanelData(value.optString("id"), value.optString("name", "Status panel"), value.optString("serverName", value.optString("serverId")), value.optBoolean("published"), value.optString("lastRefreshedAt"), value.optString("lastError"))
    }

    fun update(session: StoredSession): UpdateData {
        val value = get(session, "/v1/update").getJSONObject("update")
        return UpdateData(value.optString("status", "idle"), value.optString("currentVersion"), value.optString("availableVersion"), value.optBoolean("available"), value.optBoolean("downloaded"), value.optInt("progressPercent"), value.optString("error"))
    }

    private fun request(method: String, urlValue: String, fingerprint: String, session: StoredSession? = null, body: ByteArray = ByteArray(0), allowPending: Boolean = false): JSONObject {
        val connection = URL(urlValue).openConnection() as HttpsURLConnection
        connection.sslSocketFactory = pinnedSslSocketFactory(fingerprint)
        connection.hostnameVerifier = pinnedHostnameVerifier(fingerprint)
        connection.requestMethod = method
        connection.connectTimeout = 15000
        connection.readTimeout = 20000
        connection.useCaches = false
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("User-Agent", "Khaos-Nexus-Mobile/${BuildConfig.VERSION_NAME}")
        if (session != null) addAuthentication(connection, session, body)
        if (method == "POST") {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body) }
        }
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        val payload = runCatching { JSONObject(text.ifBlank { "{}" }) }.getOrElse { JSONObject() }
        connection.disconnect()
        if (status !in 200..299 && !(allowPending && status == 202)) {
            val error = payload.optJSONObject("error")
            throw GatewayException(status, error?.optString("code", "HTTP_$status") ?: "HTTP_$status", error?.optString("message", "Gateway request failed.") ?: "Gateway request failed.")
        }
        return payload
    }

    private fun addAuthentication(connection: HttpsURLConnection, session: StoredSession, body: ByteArray) {
        val timestamp = System.currentTimeMillis().toString()
        val nonceBytes = ByteArray(24).also(random::nextBytes)
        val nonce = Base64.encodeToString(nonceBytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        val canonical = RequestCanonical.canonical(connection.requestMethod, connection.url.file, timestamp, nonce, body)
        connection.setRequestProperty("Authorization", "Bearer ${session.credential}")
        connection.setRequestProperty("X-Khaos-Device-Id", session.deviceId)
        connection.setRequestProperty("X-Khaos-Timestamp", timestamp)
        connection.setRequestProperty("X-Khaos-Nonce", nonce)
        connection.setRequestProperty("X-Khaos-Signature", secureStore.sign(canonical))
    }

    private fun pinnedSslSocketFactory(expected: String): javax.net.ssl.SSLSocketFactory {
        val normalized = RequestCanonical.normalizeFingerprint(expected)
        val manager = object : X509TrustManager {
            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = throw java.security.cert.CertificateException("Client certificates are not accepted.")
            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                val certificate = chain?.firstOrNull() ?: throw java.security.cert.CertificateException("The desktop did not provide a certificate.")
                if (RequestCanonical.fingerprint(certificate) != normalized) throw java.security.cert.CertificateException("The desktop certificate fingerprint changed.")
                certificate.checkValidity()
            }
        }
        return SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(manager), random) }.socketFactory
    }

    private fun pinnedHostnameVerifier(expected: String): HostnameVerifier {
        val normalized = RequestCanonical.normalizeFingerprint(expected)
        return HostnameVerifier { _, session -> runCatching { RequestCanonical.fingerprint(session.peerCertificates.first() as X509Certificate) == normalized }.getOrDefault(false) }
    }
}

private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }
private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONObject.optDoubleOrNull(name: String): Double? = if (!has(name) || isNull(name)) null else optDouble(name, Double.NaN).takeUnless(Double::isNaN)
