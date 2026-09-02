# Fail-closed behavior

If Nexus Sentinal cannot prove either zero connected players or completion of the full controlled restart sequence for the current restart attempt, it must not send the host restart command.
