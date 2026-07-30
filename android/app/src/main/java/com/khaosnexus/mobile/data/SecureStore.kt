package com.khaosnexus.mobile.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.khaosnexus.mobile.model.StoredSession
import kotlinx.coroutines.flow.first
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.nexusDataStore by preferencesDataStore(name = "khaos_nexus_mobile")

class SecureStore(private val context: Context) {
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private object Keys {
        val endpoint = stringPreferencesKey("endpoint"); val fingerprint = stringPreferencesKey("fingerprint")
        val deviceId = stringPreferencesKey("device_id"); val role = stringPreferencesKey("role")
        val credentialCiphertext = stringPreferencesKey("credential_ciphertext"); val credentialIv = stringPreferencesKey("credential_iv")
    }
    private val encryptionAlias = "khaos_nexus_mobile_credential_v1"
    private val signingAlias = "khaos_nexus_mobile_signing_v1"

    suspend fun loadSession(): StoredSession? {
        val p = context.nexusDataStore.data.first()
        val values = listOf(p[Keys.endpoint].orEmpty(), p[Keys.fingerprint].orEmpty(), p[Keys.deviceId].orEmpty(), p[Keys.role].orEmpty(), p[Keys.credentialCiphertext].orEmpty(), p[Keys.credentialIv].orEmpty())
        if (values.any { it.isBlank() }) return null
        return runCatching { StoredSession(values[0], values[1], values[2], values[3], decrypt(values[4], values[5])) }.getOrNull()
    }
    suspend fun saveSession(session: StoredSession) {
        val (ciphertext, iv) = encrypt(session.credential)
        context.nexusDataStore.edit { p -> p[Keys.endpoint] = session.endpoint; p[Keys.fingerprint] = session.fingerprint; p[Keys.deviceId] = session.deviceId; p[Keys.role] = session.role; p[Keys.credentialCiphertext] = ciphertext; p[Keys.credentialIv] = iv }
    }
    suspend fun clearSession(removeSigningKey: Boolean = false) { context.nexusDataStore.edit { it.clear() }; if (removeSigningKey) runCatching { keyStore.deleteEntry(signingAlias) } }
    fun signingPublicKeyPem(): String {
        ensureSigningKey(); val encoded = keyStore.getCertificate(signingAlias).publicKey.encoded; val base64 = Base64.encodeToString(encoded, Base64.NO_WRAP)
        return "-----BEGIN PUBLIC KEY-----\n${base64.chunked(64).joinToString("\n")}\n-----END PUBLIC KEY-----\n"
    }
    fun sign(value: String): String {
        ensureSigningKey(); val signature = Signature.getInstance("SHA256withECDSA"); signature.initSign(keyStore.getKey(signingAlias, null) as java.security.PrivateKey); signature.update(value.toByteArray())
        return Base64.encodeToString(signature.sign(), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }
    private fun ensureSigningKey() {
        if (keyStore.containsAlias(signingAlias)) return
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(KeyGenParameterSpec.Builder(signingAlias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
            generateKeyPair()
        }
    }
    private fun encryptionKey(): SecretKey {
        (keyStore.getKey(encryptionAlias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(encryptionAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    private fun encrypt(value: String): Pair<String, String> { val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, encryptionKey()); return Base64.encodeToString(cipher.doFinal(value.toByteArray()), Base64.NO_WRAP) to Base64.encodeToString(cipher.iv, Base64.NO_WRAP) }
    private fun decrypt(ciphertext: String, iv: String): String { val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))); return cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)).toString(Charsets.UTF_8) }
}
