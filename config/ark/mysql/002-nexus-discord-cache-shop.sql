CREATE TABLE IF NOT EXISTS nexus_discord_cache_orders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  public_cache_id VARCHAR(24) NOT NULL,
  purchase_nonce VARCHAR(80) NOT NULL,
  discord_user_id VARCHAR(25) NOT NULL,
  player_eos_id VARCHAR(128) NOT NULL,
  cache_type VARCHAR(64) NOT NULL,
  nexus_point_cost INT UNSIGNED NOT NULL,
  species VARCHAR(100) NOT NULL,
  rarity VARCHAR(16) NOT NULL,
  variant VARCHAR(16) NOT NULL,
  blueprint VARCHAR(255) NOT NULL,
  rolled_level SMALLINT UNSIGNED NOT NULL,
  sex ENUM('male','female') NOT NULL,
  state ENUM('AWAITING_DELIVERY','DELIVERING','DELIVERED','DELIVERY_FAILED') NOT NULL DEFAULT 'AWAITING_DELIVERY',
  delivery_server_id VARCHAR(64) NOT NULL DEFAULT '',
  delivery_map_name VARCHAR(100) NOT NULL DEFAULT '',
  delivery_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  failure_class VARCHAR(32) NOT NULL DEFAULT '',
  error_message VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  delivered_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_nexus_discord_cache_public (public_cache_id),
  UNIQUE KEY uq_nexus_discord_cache_nonce (purchase_nonce),
  KEY ix_nexus_discord_cache_user (discord_user_id, created_at),
  KEY ix_nexus_discord_cache_delivery (state, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nexus_discord_cache_events (
  sequence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  actor_discord_user_id VARCHAR(25) NOT NULL DEFAULT '',
  details VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_nexus_discord_cache_event_order (order_id, sequence_id),
  CONSTRAINT fk_nexus_discord_cache_event_order FOREIGN KEY (order_id)
    REFERENCES nexus_discord_cache_orders(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
