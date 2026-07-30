package com.khaosnexus.mobile.network

import java.security.MessageDigest
import java.security.cert.X509Certificate

object RequestCanonical {
    fun bodyDigest(body: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(body).joinToString("") { "%02x".format(it) }
    fun canonical(method: String, pathAndQuery: String, timestamp: String, nonce: String, body: ByteArray): String {
        require(method.matches(Regex("^[A-Z]+$"))); require(pathAndQuery.startsWith("/v1/")); require(timestamp.matches(Regex("^\\d{10,16}$"))); require(nonce.matches(Regex("^[A-Za-z0-9_-]{16,160}$")))
        return "$method\n$pathAndQuery\n$timestamp\n$nonce\n${bodyDigest(body)}"
    }
    fun fingerprint(certificate: X509Certificate): String = fingerprint(certificate.encoded)
    fun fingerprint(encoded: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(encoded).joinToString(":") { "%02X".format(it) }
    fun normalizeFingerprint(value: String): String = value.filter { it.isDigit() || it.lowercaseChar() in 'a'..'f' }.uppercase().chunked(2).joinToString(":")
}
