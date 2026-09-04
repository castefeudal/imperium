ALTER TABLE "api_keys" ADD COLUMN "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
