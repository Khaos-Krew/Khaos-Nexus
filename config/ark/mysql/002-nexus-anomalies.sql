CREATE TABLE IF NOT EXISTS nexus_anomalies (
  id CHAR(36) NOT NULL PRIMARY KEY,
  correlation_key CHAR(64) NOT NULL,
  server_id VARCHAR(64) NOT NULL DEFAULT '',
  server_name VARCHAR(100) NOT NULL DEFAULT '',
  map_name VARCHAR(100) NOT NULL,
  dino_name VARCHAR(160) NOT NULL,
  region_name VARCHAR(160) NOT NULL DEFAULT '',
  player_name VARCHAR(100) NOT NULL DEFAULT '',
  state ENUM('ACTIVE','TAMED','KILLED','DESPAWNED','FAILED','UNKNOWN') NOT NULL,
  opened_at DATETIME(3) NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_nexus_anomalies_active (correlation_key, state, opened_at),
  KEY ix_nexus_anomalies_map (map_name, state, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nexus_anomaly_events (
  sequence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  anomaly_id CHAR(36) NOT NULL,
  event_fingerprint CHAR(64) NOT NULL,
  event_type VARCHAR(16) NOT NULL,
  event_summary VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_nexus_anomaly_event (event_fingerprint),
  KEY ix_nexus_anomaly_event_anomaly (anomaly_id, sequence_id),
  CONSTRAINT fk_nexus_anomaly_event_anomaly FOREIGN KEY (anomaly_id)
    REFERENCES nexus_anomalies(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
