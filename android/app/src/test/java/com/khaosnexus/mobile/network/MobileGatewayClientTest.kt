package com.khaosnexus.mobile.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileGatewayClientTest {
    @Test
    fun privateHostDefaultsToGatewayPortAndHttps() {
        assertEquals("https://100.64.1.20:43120", MobileGatewayClient.normalizeEndpoint("100.64.1.20"))
    }

    @Test
    fun explicitHttpsPortIsPreserved() {
        assertEquals("https://nexus.lan:4443", MobileGatewayClient.normalizeEndpoint("https://nexus.lan:4443/"))
    }

    @Test
    fun cleartextEndpointsAreRejected() {
        assertThrows(IllegalArgumentException::class.java) {
            MobileGatewayClient.normalizeEndpoint("http://nexus.lan:43120")
        }
    }
}
