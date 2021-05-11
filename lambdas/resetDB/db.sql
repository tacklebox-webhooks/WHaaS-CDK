DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS endpoints;
DROP TABLE IF EXISTS event_types;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS services;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS services (
  id serial PRIMARY KEY,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

CREATE TABLE IF NOT EXISTS users (
  id serial,
  service_id integer NOT NULL,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  PRIMARY KEY (id),
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
  UNIQUE (service_id, name)
);

CREATE TABLE IF NOT EXISTS event_types (
  id serial,
  service_id integer NOT NULL,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
	sns_topic_arn text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  PRIMARY KEY (id),
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
  UNIQUE (service_id, name)
);

CREATE TABLE IF NOT EXISTS endpoints (
  id serial,
  user_id integer NOT NULL,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  url text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id serial,
  endpoint_id integer NOT NULL,
  event_type_id integer NOT NULL,
  subscription_arn text NOT NULL UNIQUE,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  PRIMARY KEY (id),
  FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE SET NULL,
  FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS events (
  id serial,
  user_id integer NOT NULL,
  event_type_id integer NOT NULL,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL,
  idempotency_key text,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE SET NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS messages (
  id serial,
  event_id integer NOT NULL,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  endpoint text NOT NULL,
  delivered boolean NOT NULL,
  delivery_attempt integer,
  status_code integer NOT NULL,
  delivered_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  PRIMARY KEY (id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);