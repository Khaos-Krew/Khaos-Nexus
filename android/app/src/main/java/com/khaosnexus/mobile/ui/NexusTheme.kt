package com.khaosnexus.mobile.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val NexusColors = darkColorScheme(primary = Color(0xFFE3264F), onPrimary = Color.White, secondary = Color(0xFF56D9FF), background = Color(0xFF08090D), surface = Color(0xFF11151E), surfaceVariant = Color(0xFF1A202B), onBackground = Color(0xFFF1F4F8), onSurface = Color(0xFFF1F4F8), onSurfaceVariant = Color(0xFFAAB4C3), error = Color(0xFFFF6D82))

@Composable
fun NexusTheme(content: @Composable () -> Unit) { MaterialTheme(colorScheme = NexusColors, content = content) }
