package com.khaosnexus.mobile.network

import org.junit.Assert.assertEquals
import org.junit.Test

class RequestCanonicalTest {
    @Test fun canonicalRequestMatchesDesktopContract() {
        val result = RequestCanonical.canonical("GET", "/v1/servers?refresh=1", "1785360000000", "abcdefghijklmnop", ByteArray(0))
        assertEquals("GET\n/v1/servers?refresh=1\n1785360000000\nabcdefghijklmnop\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", result)
    }
    @Test fun fingerprintNormalizationUsesColonSeparatedSha256() { assertEquals("AA:BB:CC", RequestCanonical.normalizeFingerprint("aa-bb cc")) }
}
