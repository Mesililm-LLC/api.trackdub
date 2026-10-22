-- Local development only (mounted by docker-compose.yml). Creates the second
-- database the activation service uses; the portal database is created by the
-- POSTGRES_DB setting. Production uses infra/bootstrap.sql instead.
CREATE DATABASE trackdub_activation;
