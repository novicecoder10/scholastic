-- Enabled ahead of any actual vector columns so a future embeddings migration
-- (Milestone 2 / AI phase) is a frictionless additive change, not a disruptive one.
CREATE EXTENSION IF NOT EXISTS vector;
